/**
 * 把 `MatchDriver` 接进 React。
 *
 * 用 `useSyncExternalStore` 而不是自己 useState + useEffect：driver 是 React 之外的
 * 可变数据源，这个 hook 正是 React 为这种场景准备的，也顺带解决了并发渲染下
 * 读到半新半旧状态的问题。状态层因此一个库都不用引（memory 里定的）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { MatchDriver, MatchEventBatch, MatchView } from './driver'

export function useMatch(driver: MatchDriver): MatchView {
  return useSyncExternalStore(driver.subscribe, driver.getSnapshot)
}

/**
 * 订阅事件流，给演出编排层用。
 *
 * handler 存在 ref 里，所以它每次渲染换新函数也**不会**导致重新订阅——
 * 重新订阅会丢掉 driver 攒着的那批开局事件（见 driverCore 的文件头），
 * 表现是画面直接从空手牌跳到满手牌，发牌动画整段没了。
 *
 * 全局只允许一个订阅者（接口的规矩），所以这个 hook 在一棵组件树里只能挂一次。
 */
export function useMatchEvents(
  driver: MatchDriver,
  handler: (batch: MatchEventBatch) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => driver.subscribeEvents((batch) => handlerRef.current(batch)), [driver])
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
