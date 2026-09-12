/**
 * 屏幕中央的展示层，两条链路共用、严格互斥：
 * 对手出牌的**强制展示**（不可打断）和玩家自己点开的**放大查看**（点遮罩关闭）。
 *
 * 碰的是 context 的 `revealBusy` / `revealRun` / `inspecting` / `inspectHeld` / `inspectFlying`，
 * 以及演出锁（落场和飞回那两段要冻住手牌）。
 *
 * 互斥的理由是画面上只有一张展示卡、一条浮动：同一时刻两条链路一起用会互相改对方的位置。
 * 受理不了时**不排队，直接降级**——玩家看的是「对手刚打了什么」，等三秒之后再补演一遍
 * 比不演更让人糊涂。降级的代价按链路分：AI 牌退回简易进场（还看得见牌落到场上），
 * 技能牌就只剩什么都不播（它本来就不上场）。
 */

import type { CardId, InstanceId } from '@ai-duel/core'
import { pumpBanner, pumpSkillCancel } from './banner'
import type { DirectorContext, ShowcaseRun } from './context'
import { acquireLanding, releaseLanding } from './locks'
import {
  HIT_FX_MS,
  OVERLAY_OUT_MS,
  REVEAL_ABORT_MS,
  REVEAL_FADE_OUT_MS,
  REVEAL_HOLD_MS,
  REVEAL_IN_MS,
  REVEAL_OUT_MS,
  REVEAL_POP_IN_MS,
  SKILL_FLIGHT_MS,
  SUMMON_FX_MS,
} from './timings'

/** 一次强制展示要演什么。 */
export interface RevealRequest {
  cardId: CardId
  cardKind: 'ai' | 'skill'
  /** 打出的那张手牌的实例 id：展示卡从对手扇形里的这张牌起飞。 */
  handInstanceId: InstanceId
  /** AI 牌展示完要落到战场哪个格子；技能牌没有落点，是 null。 */
  landingId: InstanceId | null
  /** 技能命中的那个战场格子；打手牌的技能（模型蒸馏）和没有目标的都是 null。 */
  hitId: InstanceId | null
  /**
   * 找不到起飞点算不算「不受理」。
   *
   * AI 牌为 true：它还有简易进场兜底，宁可退回去也别凭空冒出来。
   * 技能牌为 false：它没有别的地方能看到牌面，宁可从屏幕中央淡入。
   */
  requireOrigin: boolean
  /** 起飞点在不在——对手手上还有没有牌（他中途接手一局时可能一张都没有）。 */
  hasOrigin: boolean
}

/** 排一件这一次展示的后续，登记在它自己名下，强行收场时只掐这一份。 */
function later(context: DirectorContext, run: ShowcaseRun, delayMs: number, fn: () => void): void {
  run.tasks.push(context.schedule(delayMs, fn))
}

/**
 * 受理一次强制展示。返回 false 表示不受理，调用方自己降级。
 *
 * 四道门，缺一不可：展示层已经占着；三个全屏过场里有一个立着（它们和展示层同一档，
 * 都不可打断，展示这边让路）；放大查看正在飞（这一拍插进来会把它的起飞状态丢掉）；
 * 起飞点不在而这条链路又要求起飞点。
 */
export function startReveal(context: DirectorContext, request: RevealRequest): boolean {
  if (context.revealBusy) return false
  if (context.coinUp || context.quizUp || context.cancelUp) return false
  if (context.inspectFlying) return false
  if (!request.hasOrigin && request.requireOrigin) return false

  abortInspect(context)
  // 选目标态也让位：展示层会盖住整个战场，玩家看不见自己正在选的那些格子。
  context.targeting = false
  context.revealBusy = true
  // 上一次展示的收尾（落场飞行 + 落地特效）可能还在跑，那一份留给它自己跑完，
  // 这里换一个新的记账对象，别把两次的排程混进同一串。
  const run: ShowcaseRun = { tasks: [], landingToken: null }
  context.revealRun = run

  const enterMs = request.hasOrigin ? REVEAL_IN_MS : REVEAL_POP_IN_MS
  context.emit({
    kind: 'reveal-enter',
    durationMs: enterMs,
    cardId: request.cardId,
    handInstanceId: request.handInstanceId,
    cardKind: request.cardKind,
    fromOrigin: request.hasOrigin,
  })
  later(context, run, enterMs, () => {
    context.emit({ kind: 'reveal-hold', durationMs: REVEAL_HOLD_MS })
    later(context, run, REVEAL_HOLD_MS, () => finishReveal(context, run, request))
  })
  return true
}

/** 停留到点：遮罩开始淡出，卡按各自的去向收场。 */
function finishReveal(context: DirectorContext, run: ShowcaseRun, request: RevealRequest): void {
  // 闸门要等遮罩淡完才放开：淡出期间玩家还点不动东西，这时放进第二次展示两层会打架。
  later(context, run, OVERLAY_OUT_MS, () => {
    context.revealBusy = false
    // 对方那张技能牌刚看完，这才轮到「它被抵消了」那一层。
    pumpSkillCancel(context)
    // 展示期间憋着的横幅（比如对方出完牌轮到我）到这儿才放出来。
    pumpBanner(context)
  })

  if (request.landingId !== null) {
    // 牌还要飞 0.6 秒再冒 0.8 秒烟，而遮罩已经在淡出、马上就不吃指针了，
    // 所以这段也要上演出锁，把手牌一起冻住。
    const token = acquireLanding(context, 'reveal-land')
    run.landingToken = token
    const landingId = request.landingId
    context.emit({ kind: 'reveal-land', durationMs: REVEAL_OUT_MS, instanceId: landingId })
    later(context, run, REVEAL_OUT_MS, () => {
      context.emit({ kind: 'summon-fx', durationMs: SUMMON_FX_MS, instanceId: landingId })
      later(context, run, SUMMON_FX_MS, () => {
        run.landingToken = null
        releaseLanding(context, token)
      })
    })
    return
  }

  if (request.hitId !== null) {
    const targetInstanceId = request.hitId
    context.emit({
      kind: 'skill-fly',
      durationMs: SKILL_FLIGHT_MS,
      from: 'reveal',
      cardId: request.cardId,
      targetInstanceId,
    })
    later(context, run, SKILL_FLIGHT_MS, () => {
      context.emit({ kind: 'hit-fx', durationMs: HIT_FX_MS, instanceId: targetInstanceId })
    })
    return
  }

  context.emit({ kind: 'reveal-fade', durationMs: REVEAL_FADE_OUT_MS })
}

/**
 * 强行收掉正在进行的强制展示，不播收尾。
 *
 * 只有一个调用方：答题阶段开始。展示要停 1.5 秒，而对手「出完最后一张牌就结束出牌」时
 * 那两条指令挨得很近，回合结算层会直接盖在还没演完的展示上。与其让两层打架，不如让展示让位。
 */
export function abortReveal(context: DirectorContext): void {
  if (!context.revealBusy) return
  context.revealBusy = false
  const run = context.revealRun
  context.revealRun = null
  if (run !== null) {
    for (const task of run.tasks) task.cancel()
    // 落场那段的解锁刚被一起掐掉了，锁得在这儿还回去，否则手牌永远解不开。
    // 只还这一次展示自己那把：同一时刻手上还可能压着我方出牌的锁，那把不归这里放。
    if (run.landingToken !== null) releaseLanding(context, run.landingToken)
  }
  context.emit({ kind: 'reveal-abort', durationMs: REVEAL_ABORT_MS })
}

/**
 * 现在能不能开一次放大查看。战场小卡和侧栏英雄牌共用这一份口径。
 *
 * 展示层同一时刻只归一条链路用；正在选目标时点小卡的含义是「选中它」，不该再弹放大查看；
 * 有牌正在飞或刚落地时也不受理——点开的很可能正是那张还在被飞行改写的格子。
 */
function canInspect(context: DirectorContext): boolean {
  if (context.revealBusy || context.inspecting !== null) return false
  if (context.targeting) return false
  if (context.landing) return false
  if (context.inspectFlying) return false
  return true
}

/** 点开一次放大查看：卡飞到屏幕中央，飞到位之后才允许点遮罩关掉。 */
export function openInspect(
  context: DirectorContext,
  target: { source: 'tile' | 'hero'; flipId: string },
): boolean {
  if (!canInspect(context)) return false
  context.inspecting = target
  context.inspectHeld = false
  context.inspectFlying = true
  context.emit({
    kind: 'inspect-enter',
    durationMs: REVEAL_IN_MS,
    source: target.source,
    flipId: target.flipId,
  })
  context.schedule(REVEAL_IN_MS, () => {
    context.inspectFlying = false
    context.inspectHeld = true
  })
  return true
}

/**
 * 关掉放大查看：卡飞回原来的位置。
 *
 * 飞入还没到位时不理，免得半路掉头。飞回那 0.6 秒同样要上演出锁：
 * 遮罩这时已经在淡出，挡不住指针了。
 */
export function closeInspect(context: DirectorContext): boolean {
  const target = context.inspecting
  if (target === null || !context.inspectHeld || context.inspectFlying) return false
  context.inspecting = null
  context.inspectHeld = false
  context.inspectFlying = true
  const token = acquireLanding(context, 'inspect-return')
  context.emit({
    kind: 'inspect-exit',
    durationMs: REVEAL_OUT_MS,
    source: target.source,
    flipId: target.flipId,
  })
  context.schedule(REVEAL_OUT_MS, () => {
    context.inspectFlying = false
    releaseLanding(context, token)
  })
  return true
}

/**
 * 中止正在进行的放大查看：卡直接归位，不播飞回那段动画。
 *
 * 对手出牌等不了。遮罩不用管——紧接着的强制展示会自己把它开着。
 *
 * 这里不用掐排程、也不用还演出锁：唯一的调用方 startReveal 已经把「飞入或飞回还在路上」
 * 那一档挡在门外（`inspectFlying` 那道门），走到这儿时那两段要么没开始、要么早就跑完了。
 * 对局中断那条路另有一次性清场，不走这里。
 */
export function abortInspect(context: DirectorContext): void {
  const target = context.inspecting
  if (target === null && !context.inspectFlying) return
  context.inspectFlying = false
  context.inspectHeld = false
  context.inspecting = null
  if (target !== null) {
    context.emit({
      kind: 'inspect-exit',
      durationMs: 0,
      source: target.source,
      flipId: target.flipId,
    })
  }
}
