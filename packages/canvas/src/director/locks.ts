/**
 * 带编号的演出锁：锁上之后手牌整个冻住、「结束出牌」也按不动，直到同编号的解锁。
 *
 * 碰的是 context 的 `landing` / `landingToken` / `lockFallback` 三个字段。
 *
 * 三条链路共用同一把锁：我方出牌、对手的牌展示完落场、放大查看飞回。
 * 同一时刻只可能有一条在演（展示层互斥、出牌期间又锁着手牌），所以不必做成计数。
 *
 * 编号是为了认账。旧版踩过这个坑：兜底定时器先到点把锁放了、玩家紧接着又打出下一张牌，
 * 上一条迟到的演出收尾跑到时会把**别人的**锁放掉，手牌就在演出中途解冻。
 * 所以解锁必须带上锁时拿到的编号，对不上就说明锁已经易主，这次不能放。
 */

import type { InstanceId } from '@ai-duel/core'
import type { DirectorContext } from './context'
import type { LockReason } from './cues'
import { PLAY_LOCK_FALLBACK_MS } from './timings'

/** 上一把锁，返回这次的编号，交给延迟解锁的那一方带着。 */
export function acquireLanding(context: DirectorContext, reason: LockReason): number {
  context.landingToken += 1
  context.landing = true
  context.emit({ kind: 'lock-acquire', durationMs: 0, token: context.landingToken, reason })
  return context.landingToken
}

/**
 * 出牌专用的上锁：在 `acquireLanding` 之上再挂一条兜底解锁。
 *
 * 只有出牌这两条链路（AI 牌飞向战场、技能牌中央亮相）需要兜底：它们的解锁要等对面把
 * 局面和事件送回来，中间隔着一次联机往返，是唯一可能「等不到解锁的人」的场合。
 * 演出真的起来了就把兜底撤掉（见 clearPlayLockFallback），到点还没起来就把牌放回手上
 * 再把锁放开，退回「这一下没打出去，但界面还能动」这个能忍的状态。
 *
 * 要打的那张牌的实例 id 也在这里记下（`playPending`）：没人接手时得说得出是哪一张要回来。
 */
export function acquirePlayLanding(context: DirectorContext, instanceId: InstanceId): number {
  const token = acquireLanding(context, 'play')
  context.playPending = instanceId
  context.lockFallback?.cancel()
  context.lockFallback = context.schedule(PLAY_LOCK_FALLBACK_MS, () => {
    context.lockFallback = null
    // 放锁之前先把牌收回来：光解冻手牌的话，那张飞到一半的牌会停在战场上挡着不走。
    returnPendingPlay(context)
    releaseLanding(context, token)
  })
  return token
}

/**
 * 那张刚打出去的牌没人接手了：通知场景把它放回手上。
 *
 * 三处会调到——指令被拒（events.ts）、兜底解锁到点（上面）、对局中断（director.abort）。
 * 已经被演出认领走的那张这里是 null，调了不会有任何副作用，所以调用方无需自己分辨。
 */
export function returnPendingPlay(context: DirectorContext): void {
  const instanceId = context.playPending
  if (instanceId === null) return
  context.playPending = null
  context.emit({ kind: 'play-return', durationMs: 0, instanceId })
}

/**
 * 演出收尾，把手牌和「结束出牌」放开。
 *
 * `token` 对不上号就说明锁已经易主给下一次演出了，这次不能放。
 * 不传编号是无条件强放，只给「确实该收掉一切」的场合用（中断清场）。
 */
export function releaseLanding(context: DirectorContext, token?: number): void {
  if (token !== undefined && token !== context.landingToken) return
  context.lockFallback?.cancel()
  context.lockFallback = null
  if (!context.landing) return
  context.landing = false
  context.emit({ kind: 'lock-release', durationMs: 0, token: context.landingToken })
}

/** 演出真的起来了：撤掉出牌的兜底解锁，解锁改由演出收尾负责。 */
export function clearPlayLockFallback(context: DirectorContext): void {
  context.lockFallback?.cancel()
  context.lockFallback = null
}
