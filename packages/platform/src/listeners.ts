/**
 * 一组监听器。包内自用，不从 index.ts 对外导出。
 *
 * 七项能力的每一个订阅点都是同一套动作：加进一个 Set、返回退订函数、通知时逐个调用。
 * 抄七遍不如放一处。用 Set 是为了同一个函数注册两次只留一份，退订也就不会误删别人的。
 */
export interface Signal<T> {
  /** 注册监听器，返回退订函数。 */
  add(listener: (value: T) => void): () => void
  /** 通知所有监听器。 */
  emit(value: T): void
}

export function createSignal<T = void>(): Signal<T> {
  const listeners = new Set<(value: T) => void>()
  return {
    add(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value) {
      // 先拷一份再遍历：监听器在回调里退订自己是常见写法（订阅一次性事件），
      // 直接遍历原 Set 会漏掉后面的人。
      for (const listener of [...listeners]) listener(value)
    },
  }
}
