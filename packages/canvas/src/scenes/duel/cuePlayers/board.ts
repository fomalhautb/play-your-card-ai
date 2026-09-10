/**
 * 战场上那几段：落地、命中、简易进场、罚下、进化，以及技能牌从展示位飞向目标格。
 *
 * 格子本身不是在这里建的——`applyView` 一看到视图里多了个单位就把格子建好、先藏着，
 * 这些播放器负责把它**露出来**并配上演出。分工这么定是因为「场上有谁」是局面，
 * 「什么时候看见它出现」才是演出：中途接手一局时没有任何 cue，格子照样要在。
 */

import { SKILL_FLIGHT_MS } from '../../../director/timings'
import { killAndDestroy } from '../../../runtime/dispose'
import type { DuelContext } from '../context'
import { dropShowcase } from './showcase'
import type { CuePlayerGroup } from './types'

type BoardKind = 'summon-fx' | 'hit-fx' | 'pop-in' | 'removal-fx' | 'evolve-fx' | 'skill-fly'

/** 露出一格并播落地特效。我方出牌和对手的牌落场共用这一段。 */
function landOn(ctx: DuelContext, instanceId: string): void {
  const point = ctx.tilePoint(instanceId)
  if (point === null) return
  ctx.parts.board.tile(instanceId)?.setHeld(false)
  ctx.hiddenTiles.delete(instanceId)
  ctx.parts.hitFx.play({ x: point.x, y: point.y, width: point.width, height: point.height })
}

export const boardPlayers: CuePlayerGroup<BoardKind> = {
  /** 上场落地：震屏 + 烟尘 + 追光。 */
  'summon-fx'(ctx, cue) {
    landOn(ctx, cue.instanceId)
  },

  /**
   * 命中：目标格抖一下 + 边缘追光。和落地共用同一套特效——它们本来就是同一种
   *「有东西砸在这一格上」的读法，区别只在编排层给的时长不同。
   */
  'hit-fx'(ctx, cue) {
    const point = ctx.tilePoint(cue.instanceId)
    if (point === null) return
    ctx.parts.hitFx.play({ x: point.x, y: point.y, width: point.width, height: point.height })
  },

  /** 对手 AI 牌的简易进场：强制展示受理不了时的降级路径，那一格从六成大小弹出来。 */
  'pop-in'(ctx, cue) {
    ctx.parts.board.tile(cue.instanceId)?.setHeld(false)
    ctx.hiddenTiles.delete(cue.instanceId)
    ctx.parts.board.popIn(cue.instanceId)
  },

  /** 被技能牌罚下：那张小卡沉下去化掉，演完组件自己把格子摘掉。 */
  'removal-fx'(ctx, cue) {
    ctx.doomedTiles.delete(cue.instanceId)
    ctx.hiddenTiles.delete(cue.instanceId)
    ctx.parts.board.remove(cue.instanceId)
  },

  /** 进化：换一张脸，同时弹一下、亮一圈绿光、升起一行浮字。旧的那张卡由这里销毁。 */
  'evolve-fx'(ctx, cue) {
    const next = ctx.makeCard(cue.toCardId, cue.instanceId)
    const previous = ctx.parts.board.transform(cue.instanceId, next)
    killAndDestroy(ctx.deps.animator, previous ?? next)
  },

  /**
   * 技能牌从展示位飞向目标格，飞到就消失（技能牌没有落点，它进的是弃牌堆）。
   * `from` 区分是我方亮相还是对手的强制展示接过来的，两条路的飞行完全一样，所以不分支。
   */
  'skill-fly'(ctx, cue) {
    const target = ctx.tilePoint(cue.targetInstanceId)
    if (target === null) {
      dropShowcase(ctx)
      return
    }
    ctx.parts.reveal.landTo(target)
    ctx.after(SKILL_FLIGHT_MS, () => dropShowcase(ctx))
  },
}
