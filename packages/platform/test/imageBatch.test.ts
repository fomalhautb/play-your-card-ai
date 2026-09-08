/**
 * 「一批图怎么等」的算法。web 实现和假实现共用同一份（src/imageBatch.ts），
 * 所以这里对着假实现测出来的进度和超时行为，就是真实现的行为。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakePlatform } from '../src/index'

afterEach(() => {
  vi.useRealTimers()
})

describe('首屏闸门', () => {
  it('缓存里已有的算进起点，进度不从 0 补跑一遍', async () => {
    const { images } = createFakePlatform()
    await images.load('/cards/a.webp')

    const seen: string[] = []
    await images.loadAll(['/cards/a.webp', '/cards/b.webp'], {
      onProgress: ({ loaded, total }) => seen.push(`${loaded}/${total}`),
    })
    expect(seen[0]).toBe('1/2')
    expect(seen.at(-1)).toBe('2/2')
  })

  it('清单里有重复地址也不会把进度数超', async () => {
    const { images } = createFakePlatform()
    const seen: number[] = []
    await images.loadAll(['/cards/a.webp', '/cards/a.webp'], {
      onProgress: ({ loaded }) => seen.push(loaded),
    })
    expect(Math.max(...seen)).toBe(2)
  })

  it('连着 stallMs 一张都没到就放行', async () => {
    vi.useFakeTimers()
    const { images } = createFakePlatform()
    images.setAutoComplete(false)

    let open = false
    void images.loadAll(['/cards/slow.webp'], { stallMs: 1000 }).then(() => {
      open = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(open).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(open).toBe(true)
  })

  it('每到一张就把停滞计时重新起头', async () => {
    vi.useFakeTimers()
    const { images } = createFakePlatform()
    images.setAutoComplete(false)

    let open = false
    void images.loadAll(['/cards/a.webp', '/cards/b.webp'], { stallMs: 1000 }).then(() => {
      open = true
    })
    await vi.advanceTimersByTimeAsync(800)
    images.complete('/cards/a.webp')
    // 距离上一张到货只过了 800 毫秒，闸门不该开。按「总共等了多久」算的话这里已经 1600 了。
    await vi.advanceTimersByTimeAsync(800)
    expect(open).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(open).toBe(true)
  })

  it('空清单直接放行', async () => {
    const { images } = createFakePlatform()
    const seen: string[] = []
    await images.loadAll([], { onProgress: ({ loaded, total }) => seen.push(`${loaded}/${total}`) })
    expect(seen).toEqual(['0/0'])
  })
})

describe('后台队列', () => {
  it('同时只下 concurrency 张，前一张有结果才轮到下一张', async () => {
    const { images } = createFakePlatform()
    images.setAutoComplete(false)
    const urls = ['/1.webp', '/2.webp', '/3.webp', '/4.webp']

    void images.loadInBackground(urls, { concurrency: 2 })
    expect(images.pending()).toEqual(['/1.webp', '/2.webp'])

    images.complete('/1.webp')
    await flush()
    expect(images.pending()).toEqual(['/2.webp', '/3.webp'])

    // 失败的一样算有结果，队列要继续往下走，不能停在这儿。
    images.fail('/2.webp')
    await flush()
    expect(images.pending()).toEqual(['/3.webp', '/4.webp'])
  })

  it('已经有结果的直接跳过，所以清单之间重复不要紧', async () => {
    const { images } = createFakePlatform()
    await images.load('/1.webp')
    images.setAutoComplete(false)

    void images.loadInBackground(['/1.webp', '/2.webp'], { concurrency: 1 })
    expect(images.pending()).toEqual(['/2.webp'])
  })
})

/** 让排在微任务队列里的 worker 接着往下跑。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
