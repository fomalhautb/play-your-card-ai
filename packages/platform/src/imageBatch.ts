/**
 * 「一批图怎么等」的算法。包内自用，web 实现和假实现共用同一份。
 *
 * 抽出来是因为这两段逻辑（停滞超时的闸门、限并发的后台队列）和「一张图怎么下」无关：
 * 换成假实现之后，等待的规矩应该一模一样，否则测出来的进度和超时行为不算数。
 * 所以这里只依赖一个 `settle(url)`——等一张图有结果，成功失败都算。
 */

import type { BackgroundLoadOptions, LoadAllOptions } from './images'

const DEFAULT_STALL_MS = 10_000
const DEFAULT_CONCURRENCY = 3

/** 等一张图有结果。成功和失败都要 resolve，绝不 reject。 */
export type SettleImage = (url: string, background: boolean) => Promise<void>

/** 这张图现在有结果了没有。 */
export type IsSettled = (url: string) => boolean

export function batchLoad(
  settle: SettleImage,
  isSettled: IsSettled,
  urls: readonly string[],
  options: LoadAllOptions = {},
): Promise<void> {
  const { stallMs = DEFAULT_STALL_MS, onProgress } = options
  const total = urls.length
  // 先把请求全发出去，再算起点：这一行之前不会有新的结果落地，
  // 起点算的就是缓存里已经有的那几张。
  const each = urls.map((url) => settle(url, false))
  // 逐格记「这一格算过没有」而不是只留一个计数器：缓存命中的图也会回调一次，
  // 不记的话会被数第二遍，loaded 直接超过 total。按下标记还能容忍清单里有重复地址。
  const counted = urls.map((url) => isSettled(url))
  let loaded = counted.filter(Boolean).length
  onProgress?.({ loaded, total })
  if (total === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let timer = setTimeout(resolve, stallMs)
    each.forEach((one, index) => {
      void one.then(() => {
        if (counted[index] !== true) {
          counted[index] = true
          loaded += 1
          onProgress?.({ loaded, total })
        }
        // 每到一张就把停滞计时重新起头，所以只有「连着 stallMs 一张都没到」才会放行。
        clearTimeout(timer)
        timer = setTimeout(resolve, stallMs)
      })
    })
    void Promise.all(each).then(() => {
      // 全到齐了就把计时撤掉，否则这颗定时器会一直挂到超时才自然消失。
      clearTimeout(timer)
      resolve()
    })
  })
}

export function batchBackground(
  settle: SettleImage,
  isSettled: IsSettled,
  urls: readonly string[],
  options: BackgroundLoadOptions = {},
): Promise<void> {
  const { concurrency = DEFAULT_CONCURRENCY } = options
  const pending = urls.filter((url) => !isSettled(url))
  if (pending.length === 0) return Promise.resolve()

  // 固定几个 worker 轮流从同一个下标往后取，取完收工。
  // 比按数量切成几段好在：某张图特别慢时其他 worker 会继续消化剩下的，不会有人空等。
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const url = pending[next]
      next += 1
      if (url === undefined) return
      await settle(url, true)
    }
  }
  const running = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())
  return Promise.all(running).then(() => undefined)
}
