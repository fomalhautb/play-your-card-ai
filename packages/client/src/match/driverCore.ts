/**
 * 两个 driver 共用的订阅和快照管理。
 *
 * 这里只有「谁订阅了什么、什么时候通知」这一件事，不碰网络也不碰引擎，
 * 所以 `localDriver`（迁移第 21 条）和 `serverDriver` 各自只写自己那部分差异。
 *
 * 三条订阅规矩各不相同，因为三样东西的性质不一样：
 *
 * | 订阅 | 订阅者 | 没人听的时候 |
 * |---|---|---|
 * | 局面（subscribe） | 多个 | 无所谓，快照一直在 |
 * | 事件（subscribeEvents） | **只有一个** | 攒着，第一个订阅者来了补发 |
 * | 喊话（subscribeUrge） | 多个 | 直接丢 |
 */

import type { MatchEventBatch, MatchView } from './driver'

export interface DriverCore {
  subscribe(listener: () => void): () => void
  getSnapshot(): MatchView
  subscribeEvents(listener: (batch: MatchEventBatch) => void): () => void
  /**
   * 改视图并通知订阅者。
   *
   * 每一项都和当前值比一遍，**全都没变就什么都不做**：`getSnapshot` 的契约是
   * 「无变化返回同一引用」，而联机时服务端的 `room:peer` 每次都发全量状态
   * （见协议的 `roomPeerSchema`），照单换新对象会让界面白重渲染一轮。
   * 比较是浅比较，所以 `peer` 这种嵌套对象没变时调用方要把原来那个传回来。
   */
  patch(changes: Partial<MatchView>): void
  /** 发一批事件给演出层。空批直接丢——没有事件就没有要演的东西。 */
  emitBatch(batch: MatchEventBatch): void
  subscribeUrge(listener: (id: string) => void): () => void
  /** 把一句喊话播给本端的订阅者。发不发给对面由各个 driver 自己决定。 */
  emitUrge(id: string): void
}

export function createDriverCore(initial: MatchView): DriverCore {
  let view = initial
  const listeners = new Set<() => void>()

  /*
   * 事件订阅者只留一个位置（就是演出编排层）。
   *
   * 这条限制换来一个要紧的性质：**没人订阅时事件会被攒着，等第一个订阅者来了补发**。
   * driver 是在界面挂上来之前就开始收事件的（联机的 `match:started` 在握手之后马上就到），
   * 而 React 要等渲染完的 effect 里才订阅得上——不攒着的话开局那批必然丢，
   * 画面会直接从空手牌跳到满手牌，中间的发牌动画没了。
   *
   * 攒的是**一批一批**而不是把事件拼成一个大数组：每批各带一份自己之后的局面，
   * 拼在一起就分不清哪份局面对应哪几条事件了。
   */
  let eventListener: ((batch: MatchEventBatch) => void) | null = null
  let buffered: MatchEventBatch[] = []

  /*
   * 喊话和事件两条规矩正好相反，因为要的东西不一样：
   * 允许多个订阅者（界面之外将来还想加别的反馈就直接挂上去，不用抢那一个位置），
   * 而且没人听的时候直接丢掉——催促是当下的一句话，
   * 攒到界面挂上来再补播就成了迟到的鬼叫。
   */
  const urgeListeners = new Set<(id: string) => void>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getSnapshot() {
      return view
    },

    subscribeEvents(listener) {
      eventListener = listener
      if (buffered.length > 0) {
        const pending = buffered
        buffered = []
        for (const batch of pending) listener(batch)
      }
      return () => {
        // 只清掉自己那一份：退订晚于下一个订阅者上任时，别把人家的位置抹了。
        if (eventListener === listener) eventListener = null
      }
    },

    patch(changes) {
      const keys = Object.keys(changes) as (keyof MatchView)[]
      if (keys.every((key) => Object.is(view[key], changes[key]))) return
      view = { ...view, ...changes }
      for (const listener of [...listeners]) listener()
    },

    emitBatch(batch) {
      // 局面已经由 patch 单独更新过了，一批没有事件的批对演出层来说没有任何东西要演。
      if (batch.events.length === 0) return
      if (eventListener !== null) eventListener(batch)
      else buffered.push(batch)
    },

    subscribeUrge(listener) {
      urgeListeners.add(listener)
      return () => {
        urgeListeners.delete(listener)
      }
    },

    emitUrge(id) {
      // 先拷一份再遍历：订阅者在回调里退订自己是常见写法。
      for (const listener of [...urgeListeners]) listener(id)
    },
  }
}
