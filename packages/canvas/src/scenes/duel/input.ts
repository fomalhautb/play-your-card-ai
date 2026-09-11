/**
 * 玩家的手指和鼠标：拖出出牌、点选目标、点开放大查看、结束出牌。
 *
 * 出去的东西分两路，顺序固定是**先 UserAction 后 Command**：
 * 编排层要赶在事件回来之前把演出锁上上（见 director 的 `userAction`），
 * 反过来的话指令的回包可能先到，那一拍手牌还是能拖的。
 *
 * 拖拽本身归 `interaction/handPointer.ts`（阈值、跟随、松手判定都在那儿，是纯逻辑，
 * 已经有自己的测试）。这里只接它的结论：「这张牌被打出去了」。
 * `pressAt / moveTo / releaseAt` 那三个合成入口原样透出来，第 19 条的合成指针测试按它喂坐标。
 *
 * 英雄的主动技能走的是同一条选目标的路：侧栏那颗「发动」钮按下 → `beginHeroSkill`
 * → 战场亮出合法目标 → 点一格发 `USE_HERO_SKILL`。和技能牌的区别只有两处——
 * 没有一张要从手上飞出去的牌，以及目标在哪一侧由英雄决定而不是由卡定义决定。
 * 所以选目标那份状态带一个判别标签，两条路共用其余全部逻辑。
 */

import type { HandCard, InstanceId, PlayerView } from '@ai-duel/core'
import type { BoardTile } from '../../components/BoardTile'
import type { CardSprite } from '../../components/CardSprite'
import { CASTING_DIM } from '../../components/TargetingLayer'
import type { DirectorLocks } from '../../director/director'
import { HandPointer } from '../../interaction/handPointer'
import type { DuelContext } from './context'
import { fanToWorld, toFanLocal } from './layout/types'
import {
  boardTargetsOf,
  handTargetsOf,
  heroSkillDirectionOf,
  heroSkillTargetsOf,
  targetScopeOf,
} from './skillTargets'

/** 正在给谁选目标：一张手牌，还是英雄的主动技能。 */
type Targeting =
  | {
      kind: 'card'
      instanceId: InstanceId
      card: HandCard
      scope: 'board' | 'hand'
      legal: Set<InstanceId>
    }
  | { kind: 'hero'; legal: Set<InstanceId> }

export interface DuelInput {
  /** 给一张新发的手牌挂上指针监听。 */
  bindCard(card: CardSprite): void
  /** 给一个新格子挂上点击监听（点它就是放大查看，或者在选目标时选中它）。 */
  bindTile(tile: BoardTile): void
  /** 锁变了：手牌还接不接指针、按钮灰不灰。 */
  refresh(locks: DirectorLocks, performanceLocked: boolean): void
  /** 逐帧推进拖拽的跟随，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
  /** 合成一次按下 / 移动 / 松手，第 19 条的交互测试按它喂坐标。 */
  pressAt(card: CardSprite, x: number, y: number, pointerType?: string): void
  moveTo(x: number, y: number): void
  releaseAt(x: number, y: number): void
  /**
   * 开始给英雄的主动技能选目标（侧栏那颗「发动」钮按下时走这条）。
   * 返回 false 表示这一下没被受理：现在锁着，或者一个合法目标都没有。
   */
  beginHeroSkill(): boolean
  /** 取消正在进行的选目标（切阶段、对局中断时）。 */
  cancelTargeting(): void
  destroy(): void
}

export function createDuelInput(ctx: DuelContext): DuelInput {
  let locks: DirectorLocks | null = null
  let performanceLocked = false
  let targeting: Targeting | null = null

  const canAct = (): boolean =>
    !performanceLocked && (locks === null || !locks.actionsLocked || targeting !== null)

  const pointer = new HandPointer({
    stage: ctx.stage,
    fan: ctx.parts.fan,
    dragLayer: ctx.parts.layers.drag,
    animator: ctx.deps.animator,
    dropZone: () => ctx.layout.dropZone,
    toFanLocal: (x, y) => toFanLocal(ctx.layout, x, y),
    fanToWorld: (x, y, scale) => fanToWorld(ctx.layout, x, y, scale),
    // 卡面倾斜跟着效果档位走，低档整个不开（见 fx/effectTier.ts）。这一版先不接，
    // 接上要给每张卡各存一个 CardTilt，而卡在对局里是随发随建随销的。
    tiltFor: () => undefined,
    onPlay: (card) => onPlay(card),
    enabled: () => canAct(),
    wake: () => ctx.wake(),
  })

  /** 拿一张手牌的定义。查不到（目录和牌组对不上）就当它不能打。 */
  const cardOf = (view: PlayerView, instanceId: InstanceId): HandCard | null => {
    const cardId = ctx.handCardIds.get(instanceId)
    if (cardId === undefined) return null
    return view.catalog.cards[cardId] ?? null
  }

  /** 真的把牌打出去：先告诉编排层，再发指令。 */
  const play = (instanceId: InstanceId, targetInstanceId?: InstanceId): void => {
    ctx.userAction({
      kind: 'play-card',
      instanceId,
      ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
    })
    ctx.command({
      type: 'PLAY_CARD',
      player: ctx.seat,
      instanceId,
      ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
    })
  }

  const endTargeting = (): void => {
    if (targeting === null) return
    targeting = null
    ctx.parts.targeting.end()
    ctx.parts.board.clearTargets()
    // 施放态下没被选中的牌是压暗的，收场时统一还原。
    for (const card of ctx.parts.fan.all()) card.alpha = 1
    ctx.wake()
  }

  /**
   * 开始给一张带目标的牌选目标。
   *
   * 一个合法目标都没有时不进这一步——玩家会点着满屏的暗色不知道该点哪儿，
   * 而这张牌本来也打不出去（引擎会拒）。
   */
  const beginTargeting = (instanceId: InstanceId, card: HandCard, view: PlayerView): boolean => {
    const scope = targetScopeOf(card)
    if (scope === 'none') return false
    const legal = scope === 'board' ? boardTargetsOf(view, card) : handTargetsOf(view, card)
    if (legal.length === 0) return false
    const next: Targeting = { kind: 'card', instanceId, card, scope, legal: new Set(legal) }
    targeting = next
    ctx.userAction({ kind: 'targeting-begin' })
    ctx.parts.targeting.begin(card.name)
    if (scope === 'board') ctx.parts.board.highlightTargets(legal)
    else {
      // 打向手牌的那一档：候选是自己手里的牌，压暗其余的，被压暗的那些点了没反应。
      for (const one of ctx.parts.fan.all()) {
        one.alpha = next.legal.has(one.instanceId) ? 1 : CASTING_DIM
      }
    }
    ctx.wake()
    return true
  }

  /**
   * 侧栏那颗「发动」钮按下：亮出英雄技能的合法目标。
   *
   * 一个目标都没有时不进这一步（同技能牌那条路）：玩家会点着满屏的暗色不知道该点哪儿，
   * 而这一下本来也会被引擎拒。「这一局用过了没有」不在这里判——那一条决定的是钮还在不在
   *（见 applyView.ts 的 syncHeroes）。
   */
  const beginHeroSkill = (): boolean => {
    const view = ctx.view
    if (view === null || !canAct() || targeting !== null) return false
    const hero = view.self.hero
    // 先判 null 再问方向：两者本来是一回事（没英雄就没有主动技能），但类型收窄不认后者。
    if (hero === null || heroSkillDirectionOf(hero) === null) return false
    const legal = heroSkillTargetsOf(view, hero)
    if (legal.length === 0) return false
    targeting = { kind: 'hero', legal: new Set(legal) }
    ctx.userAction({ kind: 'targeting-begin' })
    // 提示条上写技能名，和技能牌那条路写卡名是同一个口径：说清楚现在在给什么选目标。
    ctx.parts.targeting.begin(view.catalog.heroes[hero]?.skillName ?? '英雄技能')
    ctx.parts.board.highlightTargets(legal)
    ctx.wake()
    return true
  }

  /** 手牌被拖进出牌区松手（或鼠标轻点）。 */
  const onPlay = (card: CardSprite): void => {
    const view = ctx.view
    if (view === null) return
    const instanceId = card.instanceId
    // 正在给「模型蒸馏」这类牌选手牌目标时，点一张手牌的含义是选中它，不是把它打出去。
    if (targeting !== null && targeting.kind === 'card' && targeting.scope === 'hand') {
      if (!targeting.legal.has(instanceId)) return
      const pending = targeting.instanceId
      endTargeting()
      play(pending, instanceId)
      return
    }
    if (targeting !== null) return
    const definition = cardOf(view, instanceId)
    if (definition === null) return
    if (beginTargeting(instanceId, definition, view)) return
    play(instanceId)
  }

  /** 点一格：选目标时是选中它，平时是点开放大查看。 */
  const onTile = (instanceId: InstanceId): void => {
    if (targeting !== null) {
      if (!targeting.legal.has(instanceId)) return
      if (targeting.kind === 'hero') {
        endTargeting()
        // 和出牌同样的顺序：先 UserAction 后 Command（见文件头）。
        ctx.userAction({ kind: 'use-hero-skill', targetInstanceId: instanceId })
        ctx.command({ type: 'USE_HERO_SKILL', player: ctx.seat, targetInstanceId: instanceId })
        return
      }
      if (targeting.scope !== 'board') return
      const pending = targeting.instanceId
      endTargeting()
      play(pending, instanceId)
      return
    }
    ctx.userAction({ kind: 'inspect-open', source: 'tile', flipId: instanceId })
  }

  /**
   * 取消要等一次**新的**按下之后才算数。
   *
   * 进选目标态那一下本身是一次松手（牌拖进落区），Pixi 紧跟着会把它当成一次 tap
   * 派发上来——按下的是手牌、松手时指针在战场上，共同祖先就是舞台。
   * 不设这道闸的话，选目标刚立起来就被自己那一下取消掉了。
   */
  let cancelArmed = false

  /*
   * 「点空白处取消」挂在**舞台**上，不挂在选目标层上。
   *
   * 选目标层铺满全屏而且在最上面，它要是吃指针事件，被它盖住的候选格和候选手牌就全点不动了
   *（那正是这一步要玩家点的东西）。所以那一层只管压暗和提示条，不接事件（见 TargetingLayer），
   * 取消这一下由舞台兜底：点中候选的那一下会先在格子 / 手牌那儿被处理掉并收场，
   * 冒泡到这里时 targeting 已经是 null；没点中任何候选的才落到这里，一律算取消。
   */
  const onStageDown = (): void => {
    if (targeting !== null) cancelArmed = true
  }
  const onStageTap = (): void => {
    if (!cancelArmed) return
    cancelArmed = false
    if (targeting === null) return
    endTargeting()
    ctx.userAction({ kind: 'targeting-cancel' })
  }
  ctx.stage.on('pointerdown', onStageDown)
  ctx.stage.on('pointertap', onStageTap)
  // 点展示遮罩关掉放大查看。强制展示期间编排层不受理这一下，所以这里无脑发就行。
  ctx.parts.reveal.on('pointertap', () => ctx.userAction({ kind: 'inspect-close' }))

  return {
    bindCard(card) {
      pointer.bind(card)
    },

    bindTile(tile) {
      tile.eventMode = 'static'
      tile.cursor = 'pointer'
      tile.on('pointertap', () => onTile(tile.instanceId))
    },

    refresh(next, locked) {
      locks = next
      performanceLocked = locked
      ctx.parts.endPlay.setDisabled(next.endPlayLocked || locked)
      /*
       * 英雄技能钮和「结束出牌」吃同一档锁，外加一条它自己的：一个合法目标都没有时也灰着
       *（场上空着、或者能打的那几个都到链顶 / 链底了）。
       * 正在选目标的那一拍 actionsLocked 本来就是真的，钮跟着灰是对的——
       * 这时候该点的是格子，不是再按一次这颗钮。
       */
      const view = ctx.view
      const noTargets = view === null || heroSkillTargetsOf(view, view.self.hero).length === 0
      ctx.parts.panels.mine.setHeroSkillDisabled(next.actionsLocked || locked || noTargets)
      // 进答题、对局中断这些时候选目标要收掉：战场马上就被别的层盖住了。
      if (targeting !== null && next.quizWait) endTargeting()
    },

    beginHeroSkill,
    advance: (deltaMs) => pointer.advance(deltaMs),
    pressAt: (card, x, y, pointerType) => pointer.pressAt(card, x, y, pointerType),
    moveTo: (x, y) => pointer.moveTo(x, y),
    releaseAt: (x, y) => pointer.releaseAt(x, y),
    cancelTargeting: endTargeting,
    destroy() {
      pointer.destroy()
      // 舞台上只摘自己挂的这两条：指针状态机也在同一个舞台上听事件，
      // removeAllListeners() 会把它那几条一起摘掉。
      ctx.stage.off('pointerdown', onStageDown)
      ctx.stage.off('pointertap', onStageTap)
      ctx.parts.reveal.removeAllListeners()
    },
  }
}
