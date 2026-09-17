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
import { CardTilt } from '../../components/cardTilt'
import { CASTING_DIM } from '../../components/TargetingLayer'
import type { DirectorLocks } from '../../director/director'
import {
  HAND_FLIP_MS,
  HAND_UNFLIP_MS,
  PLAY_FLIP_MS,
  SKILL_SHOWCASE_IN_MS,
} from '../../director/timings'
import { HandPointer } from '../../interaction/handPointer'
import { CARD_HEIGHT } from '../../layout/fanMath'
import type { DuelContext } from './context'
import { setDropCueState } from './dropCue'
import { selfRowPointOf } from './geometry'
import { createHandMood } from './handMood'
import { fanToWorld, toFanLocal } from './layout/types'
import {
  boardTargetsOf,
  handTargetsOf,
  heroSkillDirectionOf,
  heroSkillTargetsOf,
  targetScopeOf,
} from './skillTargets'
import { createTileHover } from './tileHover'

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
  /**
   * 把一张打出去、却没有任何演出来接手的牌放回扇形（`play-return` cue 走这条）。
   * 那张牌已经不在扇形排布里、也不在指针手上了，所以只能按实例 id 找。
   */
  returnPlayedCard(instanceId: InstanceId): void
  destroy(): void
}

export function createDuelInput(ctx: DuelContext): DuelInput {
  let locks: DirectorLocks | null = null
  let performanceLocked = false
  let targeting: Targeting | null = null

  const canAct = (): boolean =>
    !performanceLocked && (locks === null || !locks.actionsLocked || targeting !== null)

  const mood = createHandMood(ctx)
  const tileHover = createTileHover(ctx, () => !performanceLocked && locks?.showcasing !== true)
  // 每张手牌各一份倾斜跟随。按卡存而不是「只留一份共用的」：卡在对局里是随发随建随销的，
  // 共用那一份会在换牌那一刻还指着上一张。卡销毁时这里跟着摘（见 bindCard）。
  const tilts = new Map<CardSprite, CardTilt>()
  const tiltFor = (card: CardSprite): CardTilt => {
    const kept = tilts.get(card)
    if (kept !== undefined) return kept
    const made = new CardTilt(card, ctx.deps.cardTilt)
    tilts.set(card, made)
    return made
  }

  const pointer = new HandPointer({
    stage: ctx.stage,
    fan: ctx.parts.fan,
    dragLayer: ctx.parts.layers.drag,
    animator: ctx.deps.animator,
    dropZone: () => ctx.layout.dropZone,
    toFanLocal: (x, y) => toFanLocal(ctx.layout, x, y),
    fanToWorld: (x, y, scale) => fanToWorld(ctx.layout, x, y, scale),
    // 卡面倾斜跟着效果档位走，低档整个不开（见 fx/effectTier.ts）。
    tiltFor,
    // 抬起来的那张恢复本色、落回去的那张跟着整排压暗，所以换一张就要重算一次灰墨态。
    onHover: () => mood.refresh(locks),
    onPlay: (card) => onPlay(card),
    onFlip: (card) => flipCard(card),
    onDropState: (state) => setDropCueState(ctx.parts.drop, state),
    enabled: () => canAct(),
    wake: () => ctx.wake(),
  })

  /**
   * 点了问号章：翻到背面看技能详情，再点一下翻回来。
   *
   * 翻面纯粹是「看一眼」，不发任何指令、也不吃演出锁——手牌冻着的时候照样翻得动
   *（黑客松同理）。两头时长不一样，理由见 timings.ts。
   */
  const flipCard = (card: CardSprite): void => {
    const toBack = !card.isFacingBack()
    ctx.deps.animator.tween(card.flipState, {
      angle: toBack ? 180 : 0,
      duration: (toBack ? HAND_FLIP_MS : HAND_UNFLIP_MS) / 1000,
      ease: 'power2.inOut',
      overwrite: 'auto',
      onUpdate: () => card.setFlipAngle(card.flipState.angle),
    })
  }

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
    // 施放态下没被选中的牌是压暗的，收场时统一还原；抬起来的那张也落回扇形。
    for (const card of ctx.parts.fan.all()) card.alpha = 1
    ctx.parts.fan.setCasting(null)
    ctx.wake()
  }

  /**
   * 开始给一张带目标的牌选目标。
   *
   * 一个合法目标都没有时不进这一步——玩家会点着满屏的暗色不知道该点哪儿，
   * 而这张牌本来也打不出去（引擎会拒）。
   */
  const beginTargeting = (sprite: CardSprite, card: HandCard, view: PlayerView): boolean => {
    const instanceId = sprite.instanceId
    const scope = targetScopeOf(card)
    if (scope === 'none') return false
    const legal = scope === 'board' ? boardTargetsOf(view, card) : handTargetsOf(view, card)
    if (legal.length === 0) return false
    const next: Targeting = { kind: 'card', instanceId, card, scope, legal: new Set(legal) }
    targeting = next
    ctx.userAction({ kind: 'targeting-begin' })
    ctx.parts.targeting.begin(card.name)
    // 施放的那张回扇形里抬起来（黑客松的 `CASTING_LIFT`）。这一步不能省：拖出去松手进到
    // 这一档时它还挂在拖拽层上，不收回去就会浮在战场中间挡着要点的那几格，取消之后也回不来。
    pointer.returnToFan(sprite)
    ctx.parts.fan.setCasting(instanceId)
    if (scope === 'board') {
      ctx.parts.board.highlightTargets(legal)
      // 战场那一档：候选在场上，整排手牌压暗，只留正在施放的那张亮着。
      for (const one of ctx.parts.fan.all()) one.alpha = one === sprite ? 1 : CASTING_DIM
    } else {
      // 打向手牌的那一档：候选是自己手里的牌，压暗其余的，被压暗的那些点了没反应。
      for (const one of ctx.parts.fan.all()) {
        one.alpha = one === sprite || next.legal.has(one.instanceId) ? 1 : CASTING_DIM
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

  /**
   * 手牌被拖进出牌区松手（或鼠标轻点）。
   *
   * 没受理的一律送回扇形：走到这儿的多半是拖到战场松手的那张，此刻还挂在拖拽层上
   *（world 最顶层、照样吃指针事件），留在那儿会把底下的战场和手牌一起挡死，再按它还会
   * 起一次原点算错的假拖拽。轻点过来的那张没被摘出扇形，`returnToFan` 自己认得出来
   *（见 handPointer），所以这里无脑调。
   */
  const onPlay = (card: CardSprite): void => {
    if (!consumePlay(card)) pointer.returnToFan(card)
  }

  /**
   * 松手之后那一小段过渡飞行：牌不能定格在指针松开的地方。
   *
   * 指令发出去到演出接手之间隔着一次回包——单机只是一两帧，联机是一整个来回。
   * 这段时间里牌就那么悬在战场正中不动，看着完全像卡死了（玩家的原话就是「卡住了」）。
   * 所以松手当场先把它送到"接下来它本来就该在的地方"，等 `play-flip` / `skill-showcase`
   * 到了再从当前位置接着演——两边都是 overwrite 'auto' 的补间，天然能接上。
   *
   * 落到哪一格只有引擎说了算，而单机那条路的回包是同步的（`play()` 返回时 applyView
   * 已经把那一格建好了），所以查得到就直接飞真正的落点；查不到（联机还在等回包）
   * 就飞我方那排的中心当中转姿态，差的只是最后一小段。
   */
  const glideAfterPlay = (card: CardSprite, kind: HandCard['kind']): void => {
    const { animator } = ctx.deps
    const showcase = kind === 'skill'
    const target = showcase
      ? ctx.parts.reveal.center()
      : (ctx.tilePoint(card.instanceId) ?? selfRowPointOf(ctx.layout))
    const duration = (showcase ? SKILL_SHOWCASE_IN_MS : PLAY_FLIP_MS) / 1000
    animator.tween(card, {
      x: target.x,
      // 落点给的是中心，而卡的原点在底边中点，所以要往下补半张卡（同 cuePlayers/hand 的 flyToTile）。
      y: target.y + (CARD_HEIGHT * target.scale) / 2,
      rotation: 0,
      duration,
      ease: 'power2.inOut',
      overwrite: 'auto',
    })
    animator.tween(card.scale, {
      x: target.scale,
      y: target.scale,
      duration,
      ease: 'power2.inOut',
      overwrite: 'auto',
    })
    ctx.wake()
  }

  /** 这一下受理没有：发了指令、或者进了选目标态才算。false 一律由 onPlay 收尾。 */
  const consumePlay = (card: CardSprite): boolean => {
    const view = ctx.view
    if (view === null) return false
    const instanceId = card.instanceId
    // 这一下是拖出来的还是原地轻点的，得在发指令**之前**问：指令是同步走完的，
    // 回包里的 applyView 会把这张牌从扇形里彻底摘掉，那之后 `isDetached` 一律是假。
    const dragged = ctx.parts.fan.isDetached(card)
    // 正在给「模型蒸馏」这类牌选手牌目标时，点一张手牌的含义是选中它，不是把它打出去。
    if (targeting !== null && targeting.kind === 'card' && targeting.scope === 'hand') {
      if (!targeting.legal.has(instanceId)) return false
      const pending = targeting.instanceId
      endTargeting()
      play(pending, instanceId)
      return true
    }
    /*
     * 正在给战场选目标时又拖了一张上来：只把这张送回去，**不动**正在选的那一档。
     * 替玩家把他已经开始的一件事收掉太唐突；真要放弃，松手那一下会冒泡到舞台，
     * 由「点空白处取消」统一处理（见下面的 onStageTap），落在候选格上的则先被格子接走。
     */
    if (targeting !== null) return false
    // 这一下打不出去（Token 不够）：弹一句小字说明为什么，不发指令。
    if (mood.popTip(card)) return false
    const definition = cardOf(view, instanceId)
    if (definition === null) return false
    if (beginTargeting(card, definition, view)) return true
    play(instanceId)
    /*
     * 要选目标、却一个目标都没有（第一轮打「黑白颠倒」、对面场上还空着就是这样）：
     * 指令照发，为什么打不出去由引擎那条红字说清楚；但这一下**必被拒**（候选名单和引擎
     * 同一份判据，见 skillTargets.ts 的文件头），所以当场就报「没受理」，
     * 让 onPlay 把它送回扇形，省掉一次白飞出去又飞回来。
     *
     * 其余被拒的理由（比如手快到 Token 已经被上一张花掉）在这里是分辨不出来的，
     * 那些由编排层的 `play-return` cue 兜底收回（见 director/locks.ts）——
     * 这一条只是"已经知道必被拒"时的一条捷径，不是唯一的收口。
     */
    if (targetScopeOf(definition) !== 'none') return false
    // 拖出来的那张此刻悬在指针松开的地方，先让它动起来（见 glideAfterPlay）。
    if (dragged) glideAfterPlay(card, definition.kind)
    return true
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

  // 取消要等一次**新的**按下之后才算数：进选目标态那一下本身是一次松手（牌拖进落区），
  // Pixi 紧跟着会把它当成一次 tap 派发上来（按下的是手牌、松手时指针在战场上，
  // 共同祖先就是舞台）。不设这道闸的话，选目标刚立起来就被自己那一下取消掉了。
  let cancelArmed = false

  // 「点空白处取消」挂在**舞台**上，不挂在选目标层上：那一层铺满全屏而且在最上面，
  // 它要是吃指针事件，被它盖住的候选格和候选手牌就全点不动了（那正是这一步要玩家点的东西）。
  // 所以那一层只管压暗和提示条，不接事件（见 TargetingLayer），取消这一下由舞台兜底：
  // 点中候选的那一下会先在格子 / 手牌那儿被处理掉并收场，冒泡到这里时 targeting 已经是 null；
  // 没点中任何候选的才落到这里，一律算取消。
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
  /*
   * 战场小卡的倾斜要知道指针在哪儿。手牌那条路由 `HandPointer` 自己听，
   * 格子这条只能另挂一条——两边听的是同一个舞台，各管各的那一块。
   */
  const onStageMove = (event: { global: { x: number; y: number } }): void => {
    const at = ctx.stage.toLocal(event.global)
    tileHover.move(at.x, at.y)
  }
  /*
   * 点侧栏那张英雄牌放大查看。只挂我方那一侧：对手那张点开也只能看到同样一张原画，
   * 多开一块热区只会把「点空白处取消选目标」吃掉一块。演出锁着时不受理。
   */
  ctx.parts.panels.mine.onHeroTap(() => {
    const hero = ctx.view?.self.hero
    if (hero === undefined || hero === null || targeting !== null || !canAct()) return
    ctx.userAction({ kind: 'inspect-open', source: 'hero', flipId: hero })
  })
  ctx.stage.on('pointerdown', onStageDown)
  ctx.stage.on('pointertap', onStageTap)
  ctx.stage.on('globalpointermove', onStageMove)
  // 点展示遮罩关掉放大查看。强制展示期间编排层不受理这一下，所以这里无脑发就行。
  ctx.parts.reveal.on('pointertap', () => ctx.userAction({ kind: 'inspect-close' }))

  return {
    bindCard(card) {
      pointer.bind(card)
      // 卡被销毁时把它那份倾斜跟随一起摘掉：不摘的话这张表会跟着一局里发过的每一张牌一直长，
      // 而每份跟随都握着卡的引用（`CardTilt` 逐帧往卡上写角度），卡就回收不掉。
      card.once('destroyed', () => tilts.delete(card))
    },

    bindTile(tile) {
      tile.eventMode = 'static'
      tile.cursor = 'pointer'
      tile.on('pointertap', () => onTile(tile.instanceId))
      tileHover.bind(tile)
    },

    refresh(next, locked) {
      locks = next
      performanceLocked = locked
      ctx.parts.endPlay.setDisabled(next.actionsLocked || locked)
      // 等对方出牌时整颗收起来——那正是它按不动的时候，留一颗灰着的钮只是占地方。
      // 用 `visible` 而不是建了又销：这颗钮一局要进出好几十次（每一轮双方各一次），
      // 每次重建都要重新烤一遍匾额上那行字的纹理（3.5 明确不许在动画期间建文字）。
      ctx.parts.endPlay.visible = !next.waitingForFoe
      // 钮收起来的那一段正是「等对方出牌」，吊匾接替它把这件事说出来。
      ctx.parts.turnPlaque?.setOn(next.waitingForFoe)
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
      // 灰墨态、逐张压暗和光标都跟着这一档锁走（见 handMood.ts）。
      mood.refresh(next)
      // 展示层立起来的那一拍格子全被盖住，正停着的那张要收手，不然它会一直斜着。
      if (next.showcasing) tileHover.release()
    },

    beginHeroSkill,
    advance(deltaMs) {
      let busy = pointer.advance(deltaMs)
      for (const tilt of tilts.values()) if (tilt.advance(deltaMs)) busy = true
      if (tileHover.advance(deltaMs)) busy = true
      return busy
    },
    pressAt: (card, x, y, pointerType) => pointer.pressAt(card, x, y, pointerType),
    moveTo: (x, y) => pointer.moveTo(x, y),
    releaseAt: (x, y) => pointer.releaseAt(x, y),
    cancelTargeting: endTargeting,
    returnPlayedCard(instanceId) {
      const card = ctx.parts.fan.all().find((one) => one.instanceId === instanceId)
      if (card === undefined) return
      // 过渡飞行还在跑就先掐掉，否则它会和回扇形那段补间抢同一对 x/y。
      ctx.deps.animator.killTweensOf(card)
      ctx.deps.animator.killTweensOf(card.scale)
      pointer.returnToFan(card)
      ctx.wake()
    },
    destroy() {
      pointer.destroy()
      mood.destroy()
      tileHover.destroy()
      ctx.parts.panels.mine.onHeroTap(null)
      tilts.clear()
      // 舞台上只摘自己挂的这三条：指针状态机也在同一个舞台上听事件，
      // removeAllListeners() 会把它那几条一起摘掉。
      ctx.stage.off('pointerdown', onStageDown)
      ctx.stage.off('pointertap', onStageTap)
      ctx.stage.off('globalpointermove', onStageMove)
      ctx.parts.reveal.removeAllListeners()
    },
  }
}
