/**
 * 手牌那三段：一批牌从卡堆飞进扇形、我方 AI 牌飞向战场格、我方技能牌在中央亮相。
 *
 * 「手上有哪几张」不是这里决定的（那是 applyView 的事）；这里只决定**什么时候看见**：
 * 新抽到的牌先在 `pendingHand` 里等着，等 `deal` cue 到点才从卡堆飞出来——
 * 不等的话开局那五张会在抛硬币的遮罩后面飞完，玩家一眼都看不见。
 */

import type { CardId } from '@ai-duel/core'
import type { CardSprite } from '../../../components/CardSprite'
import { HandFan } from '../../../components/HandFan'
import {
  PLAY_FLIP_MS,
  SKILL_SHOWCASE_HOLD_MS,
  SKILL_SHOWCASE_IN_MS,
  SKILL_SHOWCASE_OUT_MS,
} from '../../../director/timings'
import { CARD_HEIGHT } from '../../../layout/fanMath'
import { killAndDestroy } from '../../../runtime/dispose'
import type { DuelContext, LeavingCard } from '../context'
import { dropShowcase } from './showcase'
import type { CuePlayerGroup } from './types'

/**
 * 把一张已经离开扇形的牌飞到战场格上。
 *
 * 飞的是**手上那张**、落地露出的是**格子里那张**：两张卡不能同时出现在同一格上，
 * 所以飞到位的那一刻把临时那张销毁、把格子露出来。落地特效由 `summon-fx` 另外播，
 * 这里只管飞——两条 cue 各管一段，编排层排的期才对得上。
 */
function flyToTile(ctx: DuelContext, card: CardSprite, instanceId: string): void {
  const target = ctx.tilePoint(instanceId)
  if (target === null) {
    killAndDestroy(ctx.deps.animator, card)
    return
  }
  ctx.parts.layers.drag.addChild(card)
  const { animator } = ctx.deps
  const duration = PLAY_FLIP_MS / 1000
  animator.tween(card, {
    x: target.x,
    // 落点给的是格子中心，而卡的原点在底边中点，所以要往下补半张卡。
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
  ctx.after(PLAY_FLIP_MS, () => {
    ctx.parts.board.tile(instanceId)?.setHeld(false)
    ctx.hiddenTiles.delete(instanceId)
    killAndDestroy(ctx.deps.animator, card)
  })
}

/**
 * 现建一张从牌库那摞牌起飞的卡，认领不到时兜底。
 *
 * 摆进拖拽层并按牌库姿态定位，好让它和真正从手上摘下来的那几张一样——
 * 下游一律按「卡自己身上那对 x/y 就是它此刻在舞台上的位置」读姿态（见 poseOf）。
 */
function makeFromDeck(ctx: DuelContext, cardId: CardId, key: string): LeavingCard {
  const card = ctx.makeCard(cardId, key)
  const { deck } = ctx.layout
  ctx.parts.layers.drag.addChild(card)
  card.position.set(deck.x, deck.y)
  card.scale.set(deck.scale)
  return { card, cardId }
}

/** 这张等着被认领的卡此刻在舞台上的姿态。 */
function poseOf(card: CardSprite): { x: number; y: number; scale: number } {
  return { x: card.x, y: card.y, scale: card.scale.x }
}

/**
 * 取走那张刚离开手牌、等着被认领的卡。
 *
 * 按实例 id 取。取不到就现建一张从牌库位置起飞——中途接手一局、以及指令被拒之后
 * 视图没变（牌还在手上）的那两种情况会走到，不该因此什么都不演。
 */
function claimByInstance(ctx: DuelContext, instanceId: string, cardId: CardId): LeavingCard {
  const leaving = ctx.leaving.get(instanceId)
  if (leaving !== undefined) {
    ctx.leaving.delete(instanceId)
    return leaving
  }
  return makeFromDeck(ctx, cardId, `play:${instanceId}`)
}

/**
 * 技能牌那条按**卡牌 id** 取。
 *
 * `skill-showcase` 只带 cardId，不带打出的那张手牌的实例 id——编排层那边技能牌打完就进
 * 弃牌堆，实例 id 对它没有意义。所以这里在等认领的那几张里找同一张牌面的那个。
 */
function claimByCard(ctx: DuelContext, cardId: CardId): LeavingCard {
  for (const [instanceId, leaving] of ctx.leaving) {
    if (leaving.cardId !== cardId) continue
    ctx.leaving.delete(instanceId)
    return leaving
  }
  return makeFromDeck(ctx, cardId, `skill:${cardId}`)
}

export const handPlayers: CuePlayerGroup<'deal' | 'play-flip' | 'skill-showcase' | 'play-return'> =
  {
    /**
     * 一批牌从卡堆飞进扇形。
     *
     * 对手那排不需要知道是哪几张（牌背之间没有区别），所以只改张数。
     * 我方这排从 `pendingHand` 里按顺序取——那个队列由 applyView 按视图填好，
     * 顺序就是引擎发牌的顺序。
     */
    deal(ctx, cue) {
      if (cue.side === 'opponent') {
        ctx.parts.foeHand.setCount(ctx.parts.foeHand.count + cue.count)
        ctx.pendingFoeDeal = Math.max(0, ctx.pendingFoeDeal - cue.count)
        return
      }
      const taken = ctx.pendingHand.splice(0, cue.count)
      if (taken.length === 0) return
      const from = ctx.deckPose()
      const delays = new Map<string, number>()
      taken.forEach((entry, index) => {
        const card = ctx.makeCard(entry.cardId, entry.instanceId)
        ctx.parts.fan.insert(card, from)
        ctx.bindHandCard(card)
        delays.set(entry.instanceId, HandFan.staggerOf(index))
      })
      ctx.parts.fan.layout('reflow', delays)
    },

    /**
     * 这张牌没打出去：把它放回扇形。
     *
     * 指令被拒、或者兜底解锁到点都还等不到回包时走这条（见 director/locks.ts）。
     * 那两种情况下视图压根没变，牌既不进 `leaving` 也等不到 `play-flip`，
     * 不接回去就会一直停在拖拽层上——那一层在最顶上还吃指针事件，会把战场和手牌一起挡死。
     *
     * 分两种收法：牌还在手牌视图里（被拒那条）就送回扇形；已经不在了（视图变过、
     * 只是没有哪条 cue 认领它）就原地销毁，留着也没有它该去的位置。
     */
    'play-return'(ctx, cue) {
      const leaving = ctx.leaving.get(cue.instanceId)
      if (leaving !== undefined) {
        ctx.leaving.delete(cue.instanceId)
        killAndDestroy(ctx.deps.animator, leaving.card)
        return
      }
      ctx.returnPlayedCard(cue.instanceId)
    },

    /** 我方 AI 牌从手牌飞到战场格。 */
    'play-flip'(ctx, cue) {
      const claimed = claimByInstance(ctx, cue.instanceId, ctx.cardIdOf(cue.instanceId) ?? '')
      flyToTile(ctx, claimed.card, cue.instanceId)
    },

    /**
     * 我方技能牌在中央亮相。
     *
     * 有目标时这一条只演到「停够了、该起飞」为止，后面接 `skill-fly`；
     * 无目标时自己收尾——停完原地淡出，淡完把卡销毁。
     */
    'skill-showcase'(ctx, cue) {
      dropShowcase(ctx)
      const claimed = claimByCard(ctx, cue.cardId)
      // 展示位那张浮在遮罩上，投影跟着它（见 CardSprite.setLifted）。
      claimed.card.setLifted(true)
      ctx.showcased = claimed.card
      /*
       * 起飞点要在归零之前读：`RevealOverlay.enter` 把卡挂进它自己那个 slot，位置和缩放
       * 全写在 slot 上，卡在 slot 里必须待在原点。从手上摘下来的这张身上还留着舞台坐标，
       * 不归零的话它会在 slot 的位置上再偏移一整个自己的坐标，整张飞出屏幕——
       * 强制展示那条走不到这个坑，因为它用的是现建的、位置本来就是 (0, 0) 的卡。
       */
      const from = poseOf(claimed.card)
      // 松手之后那段过渡飞行可能还在跑（见 input.ts 的 glideAfterPlay），先掐掉再交给展示层，
      // 否则它会继续往中转姿态写位置，而位置这时候已经归 slot 管了。
      ctx.deps.animator.killTweensOf(claimed.card)
      ctx.deps.animator.killTweensOf(claimed.card.scale)
      claimed.card.position.set(0, 0)
      claimed.card.scale.set(1)
      ctx.parts.reveal.enter(claimed.card, from)
      if (cue.targetInstanceId !== null) return
      ctx.after(SKILL_SHOWCASE_IN_MS + SKILL_SHOWCASE_HOLD_MS, () => ctx.parts.reveal.fade())
      ctx.after(SKILL_SHOWCASE_IN_MS + SKILL_SHOWCASE_HOLD_MS + SKILL_SHOWCASE_OUT_MS, () =>
        dropShowcase(ctx),
      )
    },
  }
