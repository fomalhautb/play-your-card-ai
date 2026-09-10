/**
 * 把 `MatchDriver` 接进 React。
 *
 * 用 `useSyncExternalStore` 而不是自己 useState + useEffect：driver 是 React 之外的
 * 可变数据源，这个 hook 正是 React 为这种场景准备的，也顺带解决了并发渲染下
 * 读到半新半旧状态的问题。状态层因此一个库都不用引（memory 里定的）。
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { MatchDriver, MatchEventBatch, MatchView } from './driver'

export function useMatch(driver: MatchDriver): MatchView {
  return useSyncExternalStore(driver.subscribe, driver.getSnapshot)
}

/**
 * 还没有 driver 的时候读到的那一份。**必须是模块级常量**：
 * `useSyncExternalStore` 拿引用判有没有变，每次现造一个新对象会让组件无限重渲染。
 */
const NO_MATCH: MatchView = {
  view: null,
  seat: null,
  status: 'connecting',
  lastRejection: null,
  abortReason: null,
  link: 'down',
  peer: null,
}

/**
 * driver 可能还没有的那一档。房间页用它：进房之前手上一个 driver 都没有，
 * 进房之后要读座位和对手状态，而 hooks 不许按条件调用。
 *
 * 没有 driver 时给一份「还没连上」的空局面，形状和真的一样——
 * 界面因此不用在每一处再判一次「driver 有没有」。
 */
export function useOptionalMatch(driver: MatchDriver | null): MatchView {
  const subscribe = useCallback(
    (listener: () => void) => driver?.subscribe(listener) ?? (() => undefined),
    [driver],
  )
  const getSnapshot = useCallback(() => driver?.getSnapshot() ?? NO_MATCH, [driver])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * 订阅事件流，给演出编排层用。
 *
 * handler 存在 ref 里，所以它每次渲染换新函数也**不会**导致重新订阅——
 * 重新订阅会丢掉 driver 攒着的那批开局事件（见 driverCore 的文件头），
 * 表现是画面直接从空手牌跳到满手牌，发牌动画整段没了。
 *
 * 全局只允许一个订阅者（接口的规矩），所以这个 hook 在一棵组件树里只能挂一次。
 *
 * **driver 传 null 表示「先别订」**，这正是那条补发规矩要配合的用法：
 * 画布场景要等图集下完才建得出来，而 driver 从建出来那一刻就在产事件。
 * 没准备好就先不订，事件攒在 driverCore 里；准备好了再订，它一次性补发。
 * 抢先订上的话开局那批会被送进一个还不存在的场景，之后再也补不回来
 *（表现就是整局都是空场：没有抛硬币、没有发牌、连手牌都不出现）。
 */
export function useMatchEvents(
  driver: MatchDriver | null,
  handler: (batch: MatchEventBatch) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (driver === null) return
    return driver.subscribeEvents((batch) => handlerRef.current(batch))
  }, [driver])
}

/**
 * 订阅「催一催」的喊话。
 *
 * 和事件流相反：允许多个订阅者、没有补发缓冲（催促是当下的一句话，补播就成了迟到的鬼叫）。
 * handler 同样存 ref，理由一样。
 */
export function useMatchUrge(driver: MatchDriver, handler: (id: string) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => driver.subscribeUrge((id) => handlerRef.current(id)), [driver])
}
