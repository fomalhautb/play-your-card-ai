/**
 * 中央横幅队列，以及和它共用同一组闸门的英雄技能抵消层。
 *
 * 碰的是 context 的 `bannerQueue` / `bannerBusy` / `pendingCancel` / `cancelUp`。
 *
 * 两件事放在一个文件里，是因为它们的判据是同一套：屏幕正中同一时刻只该有一样东西在说话。
 * 横幅让路给三个全屏过场和展示层（四道闸门），抵消层还要多让一档「技能牌亮相」——
 * 抵消提示和它对应的那张技能牌是同一批事件，抵消层先上就会盖住牌面，
 * 玩家根本没看清被抵消的是什么牌。
 */

import type { DirectorContext, PendingCancel } from './context'
import { BANNER_TOTAL_MS, SKILL_CANCEL_TOTAL_MS } from './timings'

/**
 * 播队列里的下一条横幅。已经有一条在播、或者全屏过场 / 展示层正占着，就先不动。
 *
 * 播完在排程回调里再调自己接着播下一条，队列彻底空了才报 `round-banner-done`——
 * 教程的提示要等它，否则会和横幅糊在一起。
 */
export function pumpBanner(context: DirectorContext): void {
  if (context.bannerBusy || context.coinUp || context.quizUp || context.cancelUp) return
  if (context.revealBusy) return
  const text = context.bannerQueue.shift()
  if (text === undefined) return
  context.bannerBusy = true
  context.emit({ kind: 'banner', durationMs: BANNER_TOTAL_MS, text })
  context.schedule(BANNER_TOTAL_MS, () => {
    context.bannerBusy = false
    pumpBanner(context)
    // pumpBanner 已经把下一条起起来了的话 bannerBusy 是开着的，这一下不成立。
    if (!context.bannerBusy && context.bannerQueue.length === 0) {
      context.emit({ kind: 'tutorial', durationMs: 0, cue: 'round-banner-done' })
    }
  })
}

/**
 * 中央横幅：把「第几轮了、该谁出牌」这类轻量提示用一行大字念出来。
 *
 * 一次只显示一条。一批事件里常常连着来两条（每轮开头的 ROUND_STARTED + PLAY_TURN_STARTED），
 * 同时画在屏幕正中会糊成一团，所以排队一条条播。
 */
export function showBanner(context: DirectorContext, text: string): void {
  context.bannerQueue.push(text)
  pumpBanner(context)
}

/**
 * 放出憋着的抵消提示。
 *
 * 三处调用：收到事件时试一次（那一刻没有演出在放就直接上），
 * 我方技能牌亮相收尾时、对方强制展示收尾时各试一次。
 */
export function pumpSkillCancel(context: DirectorContext): void {
  const pending = context.pendingCancel
  if (pending === null) return
  if (context.skillShowBusy > 0 || context.revealBusy) return
  // 抛硬币和答题揭晓同在最上面那一档且不可打断，撞上就继续等它们的收尾来喊。
  if (context.coinUp || context.quizUp || context.cancelUp) return
  context.pendingCancel = null
  context.cancelUp = true
  context.emit({
    kind: 'skill-cancel',
    durationMs: SKILL_CANCEL_TOTAL_MS,
    heroId: pending.heroId,
    title: pending.title,
    text: pending.text,
  })
  context.schedule(SKILL_CANCEL_TOTAL_MS, () => {
    context.cancelUp = false
    // 第二条抵消提示如果是在这一层演着的时候到的，它对应的强制展示会被上面那道闸门挡掉，
    // 不会再有别的收尾来放行——所以这里放开闸门后要自己接力一次。
    pumpSkillCancel(context)
    pumpBanner(context)
  })
}

/** 记下一条待演的抵消提示，并当场试一次能不能直接放。 */
export function queueSkillCancel(context: DirectorContext, pending: PendingCancel): void {
  context.pendingCancel = pending
  pumpSkillCancel(context)
}
