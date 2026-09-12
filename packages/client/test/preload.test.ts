/**
 * 首屏闸门和后台预加载。
 *
 * 假平台的 images 用的是和网页实现同一份「一批图怎么等」的算法（platform 的 imageBatch.ts），
 * 只是每张图什么时候到货由测试说了算，所以这里测出来的进度和超时行为就是真实现的行为。
 */

import type { FakePlatform } from '@ai-duel/platform'
import { createFakePlatform } from '@ai-duel/platform'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreloadState } from '../src/preload/preload'
import {
  PRELOAD_STALL_MS,
  preloadAll,
  preloadInBackground,
  preloadState,
} from '../src/preload/preload'

const URLS = ['/home/a.webp', '/home/b.webp', '/home/c.webp', '/home/d.webp']

let platform: FakePlatform

/**
 * 把排着队的微任务全放掉。
 *
 * 假实现是在微任务里结算的，而后台队列每下完一张要过好几层 await 才轮到下一张，
 * 数着调几次 `Promise.resolve()` 太脆，让出一整轮宏任务最稳。
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  platform = createFakePlatform()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('首屏闸门', () => {
  it('全部到齐就放行，进度一路走到满格', async () => {
    const seen: PreloadState[] = []
    await preloadAll(platform, URLS, (state) => seen.push(state))
    expect(seen.at(-1)).toEqual({ ready: true, progress: 1 })
    // 中间每一步都在往前走，且不越过 1。
    for (const state of seen) expect(state.progress).toBeLessThanOrEqual(1)
    expect(seen.map((state) => state.progress)).toEqual(
      [...seen.map((s) => s.progress)].sort((a, b) => a - b),
    )
  })

  it('进度只往前走，同一张图到两次也只算一格', async () => {
    platform.images.setAutoComplete(false)
    const seen: number[] = []
    // 清单里有重复地址：按下标记「这一格算过没有」才不会把同一张数两遍。
    const withDuplicate = [URLS[0]!, URLS[0]!, URLS[1]!]
    const gate = preloadAll(platform, withDuplicate, (state) => seen.push(state.progress))
    await Promise.resolve()
    platform.images.complete(URLS[0]!)
    platform.images.complete(URLS[1]!)
    await gate
    expect(seen.at(-1)).toBe(1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  // 图挂了 onerror 会立刻回来，但请求卡在那儿不上不下是没有回调的。
  // 没这道闸就会永远停在加载页上，所以宁可放行，缺的图会自己在后面补上。
  it('连着 PRELOAD_STALL_MS 一张都没到就放行，并补成满格', async () => {
    vi.useFakeTimers()
    platform.images.setAutoComplete(false)
    const seen: PreloadState[] = []
    const gate = preloadAll(platform, URLS, (state) => seen.push(state))
    await vi.advanceTimersByTimeAsync(PRELOAD_STALL_MS)
    await gate
    // 一张都没到，但闸门开了，而且进度补满——让玩家看着一条没走完的进度条切走像是出了错。
    expect(seen.at(-1)).toEqual({ ready: true, progress: 1 })
  })

  it('只要还在一张接一张地到货就接着等，计时每次从头起', async () => {
    vi.useFakeTimers()
    platform.images.setAutoComplete(false)
    let done = false
    const gate = preloadAll(platform, URLS, undefined).then(() => {
      done = true
    })
    for (const url of URLS.slice(0, 3)) {
      await vi.advanceTimersByTimeAsync(PRELOAD_STALL_MS - 1)
      platform.images.complete(url)
      await Promise.resolve()
      expect(done).toBe(false)
    }
    platform.images.complete(URLS[3]!)
    await gate
    expect(done).toBe(true)
  })

  it('加载失败的也算「等到了」', async () => {
    platform.images.setAutoComplete(false)
    const gate = preloadAll(platform, [URLS[0]!])
    await Promise.resolve()
    platform.images.fail(URLS[0]!)
    // 缺一张图是画面问题，卡在加载页里进不去是致命问题。
    await expect(gate).resolves.toBeUndefined()
  })

  it('空清单直接就绪，不会除出 NaN', async () => {
    const seen: PreloadState[] = []
    await preloadAll(platform, [], (state) => seen.push(state))
    expect(seen.at(-1)).toEqual({ ready: true, progress: 1 })
  })
})

describe('首帧状态', () => {
  it('一张都没下过时是未就绪、进度 0', () => {
    expect(preloadState(platform, URLS)).toEqual({ ready: false, progress: 0 })
  })

  // 从别的页面回到首页时图早就有结果了，先问一句就不用闪一下加载页。
  it('都有结果之后第一帧就是就绪', async () => {
    await preloadAll(platform, URLS)
    expect(preloadState(platform, URLS)).toEqual({ ready: true, progress: 1 })
  })

  it('下了一半时报的是真实比例', async () => {
    platform.images.setAutoComplete(false)
    void preloadAll(platform, URLS)
    await Promise.resolve()
    platform.images.complete(URLS[0]!)
    platform.images.complete(URLS[1]!)
    expect(preloadState(platform, URLS)).toEqual({ ready: false, progress: 0.5 })
  })

  it('空清单当作已经满了', () => {
    expect(preloadState(platform, [])).toEqual({ ready: true, progress: 1 })
  })
})

describe('后台预加载', () => {
  it('一组下完才开下一组', async () => {
    platform.images.setAutoComplete(false)
    const first = ['/room/a.webp', '/room/b.webp']
    const second = ['/battle/a.webp']
    const queue = preloadInBackground(platform, [first, second])
    await flush()
    // 分组的意义就是「先用到的先下」，全丢进同一个队列的话后面那组会来抢并发额度。
    expect(platform.images.pending()).toEqual(first)

    for (const url of first) platform.images.complete(url)
    await flush()
    expect(platform.images.pending()).toEqual(second)
    for (const url of second) platform.images.complete(url)
    await queue
  })

  it('已经有结果的直接跳过，所以清单之间重复不要紧', async () => {
    await preloadAll(platform, [URLS[0]!])
    platform.images.setAutoComplete(false)
    const queue = preloadInBackground(platform, [[URLS[0]!]])
    // 一张都不用再下，整组立刻收工。
    await expect(queue).resolves.toBeUndefined()
    expect(platform.images.pending()).toEqual([])
  })
})
