/**
 * 展示层的两条链路：对手出牌的**强制展示**和玩家自己点开的**放大查看**。
 *
 * 两条共用同一块 `RevealOverlay`（编排层保证它们严格互斥），区别只在卡从哪儿飞来、飞到哪儿去：
 * 强制展示从对手那排牌背里起飞、落到战场格或原地淡出；放大查看从战场格起飞、再飞回同一格。
 *
 * 「卡飞到位之后要做什么」全部排在场景自己的虚拟时钟上（`ctx.after`），
 * 不用组件的补间回调：那样「现在演到哪儿」会散回一堆回调里，正是编排层要消灭的东西。
 */

import { REVEAL_FADE_OUT_MS, REVEAL_OUT_MS } from '../../../director/timings'
import { FOE_FAN_SCALE } from '../layout/types'
import { dropShowcase } from './showcase'
import type { CuePlayerGroup } from './types'

/** 放大查看时卡底下那行字。固定一句而不是印卡名：这一层要说的是「点哪儿能关掉」。 */
const INSPECT_CAPTION = '点击任意处关闭'

type RevealKind =
  | 'reveal-enter'
  | 'reveal-hold'
  | 'reveal-land'
  | 'reveal-fade'
  | 'reveal-abort'
  | 'inspect-enter'
  | 'inspect-exit'

export const revealPlayers: CuePlayerGroup<RevealKind> = {
  /**
   * 对手的牌飞到屏幕中央并翻正。
   *
   * `fromOrigin` 为真时从他那排牌背里挑一张摘下来当起飞点——摘哪一张画面上都一样
   *（牌背之间没有区别），所以取中间那张，起飞轨迹最短也最像「从手里抽出来」。
   * 为假是降级路径：找不到起飞点，改成从中央淡入（组件收到 `from` 为 null 就走那一档）。
   */
  'reveal-enter'(ctx, cue) {
    dropShowcase(ctx)
    const card = ctx.makeCard(cue.cardId, `reveal:${cue.handInstanceId}`)
    ctx.showcased = card
    const { foeHand } = ctx.parts
    let from = null
    if (cue.fromOrigin && foeHand.count > 0) {
      const taken = foeHand.takeCard(Math.floor(foeHand.count / 2))
      if (taken !== null) {
        from = {
          x: foeHand.x + taken.x,
          y: foeHand.y + taken.y,
          scale: FOE_FAN_SCALE,
        }
      }
    }
    ctx.parts.reveal.enter(card, from)
  },

  'reveal-hold'(ctx) {
    ctx.parts.reveal.hold()
  },

  /**
   * 展示位的 AI 牌接着飞到战场格。
   *
   * 落点那一格是 applyView 已经建好、还藏着的（见 applyView.ts），飞到位才把它露出来，
   * 同时把飞行用的那张临时卡销毁——两张卡不能同时出现在同一格上。
   */
  'reveal-land'(ctx, cue) {
    const target = ctx.tilePoint(cue.instanceId)
    if (target === null) {
      dropShowcase(ctx)
      return
    }
    ctx.parts.reveal.landTo(target)
    ctx.after(REVEAL_OUT_MS, () => {
      ctx.parts.board.tile(cue.instanceId)?.setHeld(false)
      ctx.hiddenTiles.delete(cue.instanceId)
      dropShowcase(ctx)
    })
  },

  /** 展示的技能牌没有落点，原地淡出。 */
  'reveal-fade'(ctx) {
    ctx.parts.reveal.fade()
    ctx.after(REVEAL_FADE_OUT_MS, () => dropShowcase(ctx))
  },

  /** 强行收掉：卡直接消失，只有遮罩自己淡掉。 */
  'reveal-abort'(ctx) {
    ctx.parts.reveal.abort()
    dropShowcase(ctx)
  },

  /**
   * 点开一张战场小卡放大查看：原格让位（格子留着但藏起来），另建一张卡飞到中央。
   *
   * 侧栏那张英雄牌暂时走不到这条——英雄原画还没搬进新客户端（第 33 条），
   * 侧栏的英雄位是空的，`source` 为 'hero' 时这里什么都不做。
   */
  'inspect-enter'(ctx, cue) {
    if (cue.source !== 'tile') return
    const point = ctx.tilePoint(cue.flipId)
    const tile = ctx.parts.board.tile(cue.flipId)
    // 卡面身份从视图里查，不从格子上那张卡问：`CardSprite.cardId` 存的是**实例** id
    //（扇形和战场都按它认牌），拿它当卡牌 id 会查出一张不存在的牌。
    const cardId = ctx.cardIdOf(cue.flipId)
    if (point === null || tile === null || cardId === null) return
    dropShowcase(ctx)
    const card = ctx.makeCard(cardId, `inspect:${cue.flipId}`)
    ctx.showcased = card
    ctx.inspectingTile = cue.flipId
    tile.setHeld(true)
    ctx.parts.reveal.enter(card, point)
    ctx.parts.reveal.showCaption(INSPECT_CAPTION)
  },

  /**
   * 关掉放大查看：卡飞回原来那一格。
   *
   * `durationMs` 为 0 是编排层的「不播飞回、直接归位」那条（对手出牌等不了），
   * 这时立刻把格子露出来，不排后续。
   */
  'inspect-exit'(ctx, cue) {
    const instanceId = ctx.inspectingTile
    ctx.inspectingTile = null
    const restore = () => {
      if (instanceId !== null) ctx.parts.board.tile(instanceId)?.setHeld(false)
      dropShowcase(ctx)
      ctx.wake()
    }
    const point = instanceId === null ? null : ctx.tilePoint(instanceId)
    if (cue.durationMs === 0 || point === null) {
      ctx.parts.reveal.abort()
      restore()
      return
    }
    ctx.parts.reveal.landTo(point)
    ctx.after(REVEAL_OUT_MS, restore)
  },
}
