/**
 * 发牌闸门：开局那 5 张和每轮结算后补的 2 张什么时候才准从卡堆飞出来。
 *
 * 碰的是 context 的 `dealHeld` / `dealBusy` / `pendingDeal` 和三条排程
 *（两条兜底放行 + 一条「这批牌落地」）。
 *
 * 憋着的理由是全屏过场：开局那批要等抛硬币演完（屏幕整个被遮罩盖着），
 * 每轮补的那批要等回合结算层退场——不拦的话牌就在遮罩后面飞完了，玩家一眼都没看见。
 * 两条正常放行的路都在别处（抛硬币收尾、结算层退场），这里只留兜底：
 * 那两条路要是压根没走到（联机客人中途接手、结算层被提前换掉），牌不能一直压在卡堆上。
 */

import type { DirectorContext } from './context'
import {
  DEAL_CARD_MS,
  DEAL_HOLD_FALLBACK_MS,
  DEAL_STAGGER_MS,
  ROUND_DEAL_FALLBACK_MS,
} from './timings'

/** 一批 n 张牌从起飞到全部落地要多久：逐张错开起飞，最后一张飞完才算完。 */
function dealDuration(count: number): number {
  return DEAL_CARD_MS + Math.max(0, count - 1) * DEAL_STAGGER_MS
}

/** 「发牌还没演完」：牌压在卡堆上等放行，或者已经在飞、还没全部落地。 */
export function isDealing(context: DirectorContext): boolean {
  return context.dealHeld || context.dealBusy
}

/**
 * 认「发完了」的下降沿，发一次教程信号。
 *
 * 只认下降沿：教程等的是「牌已经躺进手里」这个时刻，牌还在飞的时候说什么都没用。
 * 每次动过闸门或飞行状态都要调一次。
 */
function syncDealing(context: DirectorContext): void {
  const dealing = isDealing(context)
  if (context.dealingBefore === dealing) return
  context.dealingBefore = dealing
  if (!dealing) context.emit({ kind: 'tutorial', durationMs: 0, cue: 'deal-done' })
}

/** 记一张刚抽到的牌。还憋着就先攒着，放行时一起飞。 */
export function noteDrawn(context: DirectorContext, side: 'self' | 'opponent'): void {
  context.pendingDeal[side] += 1
}

/**
 * 把攒着的牌发出去。闸门还关着就什么都不做。
 *
 * 一批事件里的抽牌一起飞（双方同一批补牌同时起飞也同时落地），所以这个函数在
 * 一批事件处理完之后调一次，不是每来一条 CARD_DRAWN 调一次。
 */
export function flushDeal(context: DirectorContext): void {
  if (context.dealHeld) {
    syncDealing(context)
    return
  }
  const { self, opponent } = context.pendingDeal
  if (self === 0 && opponent === 0) {
    syncDealing(context)
    return
  }
  context.pendingDeal = { self: 0, opponent: 0 }
  const selfMs = dealDuration(self)
  const foeMs = dealDuration(opponent)
  if (self > 0) {
    context.emit({ kind: 'deal', durationMs: selfMs, side: 'self', count: self })
  }
  if (opponent > 0) {
    context.emit({ kind: 'deal', durationMs: foeMs, side: 'opponent', count: opponent })
  }
  context.dealBusy = true
  context.dealBusyTask?.cancel()
  context.dealBusyTask = context.schedule(Math.max(selfMs, foeMs), () => {
    context.dealBusyTask = null
    context.dealBusy = false
    syncDealing(context)
  })
  syncDealing(context)
}

/** 放行憋着的牌，顺手撤掉两条兜底。抛硬币收尾和结算层退场各调一次。 */
export function releaseDeal(context: DirectorContext): void {
  context.dealHoldFallback?.cancel()
  context.dealHoldFallback = null
  context.roundDealFallback?.cancel()
  context.roundDealFallback = null
  context.dealHeld = false
  flushDeal(context)
}

/**
 * 对局中断时的一次性清场：闸门和飞行状态全部放开，攒着的牌直接丢掉不演。
 *
 * 抛硬币和结算层都被收掉了，放行发牌的那两条收尾也就不会来了；牌不该一直压在卡堆上。
 * 但也不该在这时候补演一段发牌——对局已经结束了，那段动画没有意义。
 */
export function resetDeal(context: DirectorContext): void {
  context.dealHoldFallback?.cancel()
  context.dealHoldFallback = null
  context.roundDealFallback?.cancel()
  context.roundDealFallback = null
  context.dealBusyTask?.cancel()
  context.dealBusyTask = null
  context.dealHeld = false
  context.dealBusy = false
  context.pendingDeal = { self: 0, opponent: 0 }
  syncDealing(context)
}

/**
 * 开局那条兜底放行：这一局要是根本没有抛硬币过场，也得让开局手牌飞出来。
 *
 * 到点了还要再看一眼「硬币是不是正演着」：收到 GAME_STARTED 时会撤掉这条，
 * 但撤得晚一拍时（开局事件先于本条排程到期）硬币已经立起来了，那时不该放行。
 */
export function armOpeningDealFallback(context: DirectorContext): void {
  context.dealHoldFallback?.cancel()
  context.dealHoldFallback = context.schedule(DEAL_HOLD_FALLBACK_MS, () => {
    context.dealHoldFallback = null
    if (context.coinUp) return
    context.dealHeld = false
    flushDeal(context)
  })
}

/** 抛硬币过场真的要演了：撤掉开局那条兜底，放行改由过场的收尾负责。 */
export function clearOpeningDealFallback(context: DirectorContext): void {
  context.dealHoldFallback?.cancel()
  context.dealHoldFallback = null
}

/**
 * 把回合末的补牌重新憋住，并上一条兜底放行。
 *
 * 兜底刻意取短（见 ROUND_DEAL_FALLBACK_MS）：它一到点就放行，那时结算层要是还立着，
 * 牌就跑到遮罩后面去飞了，正是这条兜底本来要防的事情反过来发生。
 */
export function holdRoundDeal(context: DirectorContext): void {
  context.dealHeld = true
  context.roundDealFallback?.cancel()
  context.roundDealFallback = context.schedule(ROUND_DEAL_FALLBACK_MS, () => {
    context.roundDealFallback = null
    context.dealHeld = false
    flushDeal(context)
  })
  syncDealing(context)
}
