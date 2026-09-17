/**
 * 我方出牌那条链路的演出：AI 牌飞向战场格、技能牌中央亮相（有目标的接一段飞行和命中）。
 *
 * 单独一个文件是因为它和对手那条（reveal.ts）是对称的两条链路，长度也差不多，
 * 挤在事件分支里会让那边看不出「一条事件对一段演出」的结构。
 *
 * 两条链路共用同一把演出锁，但拿锁的时机不同：我方是玩家点下去那一刻就上
 *（那时还没有任何事件），对方是展示演完要落场时才上。
 */

import type { CardId, InstanceId } from '@ai-duel/core'
import { pumpSkillCancel } from './banner'
import type { DirectorContext } from './context'
import { acquireLanding, clearPlayLockFallback, releaseLanding } from './locks'
import {
  HIT_FX_MS,
  PLAY_FLIP_MS,
  SKILL_FLIGHT_MS,
  SKILL_SHOWCASE_HOLD_MS,
  SKILL_SHOWCASE_IN_MS,
  SKILL_SHOWCASE_OUT_MS,
  SKILL_TARGET_HOLD_MS,
  SUMMON_FX_MS,
} from './timings'

/** 我方技能牌亮相彻底演完之后的销账，两条分支共用。 */
function finishSkillShow(context: DirectorContext, token: number): void {
  context.skillShowBusy = Math.max(0, context.skillShowBusy - 1)
  pumpSkillCancel(context)
  releaseLanding(context, token)
}

/**
 * 我方出牌那把锁：正常是玩家点下去时就上了（见 director 的 userAction），
 * 这里只把它接过来。没有的话现上一把——回放和联机中途接手都会走到这条。
 */
function takePlayLock(context: DirectorContext): number {
  const token = context.playLockToken
  context.playLockToken = null
  // 演出接手了那张牌，它就不再是「没人管的一张」——留着的话兜底到点会把已经飞走的牌往回收。
  context.playPending = null
  clearPlayLockFallback(context)
  return token ?? acquireLanding(context, 'play')
}

/** 我方 AI 牌落场：从手牌飞到战场格，落地演特效，特效演完才解锁。 */
export function playMyAi(context: DirectorContext, instanceId: InstanceId): void {
  const token = takePlayLock(context)
  context.emit({ kind: 'play-flip', durationMs: PLAY_FLIP_MS, instanceId })
  context.schedule(PLAY_FLIP_MS, () => {
    context.emit({ kind: 'summon-fx', durationMs: SUMMON_FX_MS, instanceId })
    context.schedule(SUMMON_FX_MS, () => releaseLanding(context, token))
  })
}

/**
 * 我方技能牌亮相：中央淡入停一会儿。
 * 有战场目标的把淡出换成「飞向目标格 + 命中特效」，整条加起来才和亮个相差不多长。
 */
export function playMySkill(
  context: DirectorContext,
  cardId: CardId,
  targetInstanceId: InstanceId | null,
): void {
  context.skillShowBusy += 1
  const token = takePlayLock(context)
  if (targetInstanceId === null) {
    const total = SKILL_SHOWCASE_IN_MS + SKILL_SHOWCASE_HOLD_MS + SKILL_SHOWCASE_OUT_MS
    context.emit({ kind: 'skill-showcase', durationMs: total, cardId, targetInstanceId })
    context.schedule(total, () => finishSkillShow(context, token))
    return
  }
  const untilFlight = SKILL_SHOWCASE_IN_MS + SKILL_TARGET_HOLD_MS
  context.emit({ kind: 'skill-showcase', durationMs: untilFlight, cardId, targetInstanceId })
  context.schedule(untilFlight, () => {
    context.emit({
      kind: 'skill-fly',
      durationMs: SKILL_FLIGHT_MS,
      from: 'showcase',
      cardId,
      targetInstanceId,
    })
    context.schedule(SKILL_FLIGHT_MS, () => {
      context.emit({ kind: 'hit-fx', durationMs: HIT_FX_MS, instanceId: targetInstanceId })
      finishSkillShow(context, token)
    })
  })
}
