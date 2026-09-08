// @vitest-environment happy-dom
/**
 * 安全区与视口：订阅只在值真的变了的时候报，退订之后彻底安静。
 *
 * 这两条是接口写死的约定（见 src/safeArea.ts）。第一条尤其要紧：转屏期间浏览器会连着
 * 报好几次同样的尺寸，原样转发会让画面为同一件事重排好几遍。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createFakePlatform } from '../src/index'
import { createWebSafeArea } from '../src/web/safeArea'

const originalWidth = window.innerWidth
const originalHeight = window.innerHeight

afterEach(() => {
  setViewport(originalWidth, originalHeight)
})

describe('假实现', () => {
  it('只改其中几项，其余保持不变', () => {
    const { safeArea } = createFakePlatform()
    const before = safeArea.metrics()
    safeArea.set({ insets: { ...before.insets, bottom: 34 } })
    const after = safeArea.metrics()
    expect(after.width).toBe(before.width)
    expect(after.insets).toEqual({ ...before.insets, bottom: 34 })
  })

  it('值没变就不通知，变了才通知一次', () => {
    const { safeArea } = createFakePlatform()
    const seen: number[] = []
    safeArea.onChange((metrics) => seen.push(metrics.width))

    safeArea.set({ width: safeArea.metrics().width })
    safeArea.set({ width: 375, height: 812, orientation: 'portrait' })
    safeArea.set({ width: 375 })
    expect(seen).toEqual([375])
  })

  it('退订之后不再收到', () => {
    const { safeArea } = createFakePlatform()
    let calls = 0
    const off = safeArea.onChange(() => {
      calls += 1
    })
    safeArea.set({ width: 100 })
    off()
    safeArea.set({ width: 200 })
    expect(calls).toBe(1)
  })
})

describe('web 实现', () => {
  it('量的是当前视口，安全区量不出来时是 0', () => {
    const safeArea = createWebSafeArea()
    setViewport(1024, 768)
    const metrics = safeArea.metrics()
    expect(metrics.width).toBe(1024)
    expect(metrics.height).toBe(768)
    // 假 DOM 不认 env(safe-area-inset-*)，那条 padding 声明会被整条丢掉——
    // 和「这台设备没有刘海」是同一种结果。
    expect(metrics.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('窗口尺寸变了报一次，同一个尺寸再报一次不算', () => {
    const safeArea = createWebSafeArea()
    const seen: number[] = []
    const off = safeArea.onChange((metrics) => seen.push(metrics.width))

    setViewport(800, 600)
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(seen).toEqual([800])

    off()
    setViewport(640, 480)
    window.dispatchEvent(new Event('resize'))
    expect(seen).toEqual([800])
  })
})

/**
 * 改视口尺寸。
 *
 * 直接改 innerWidth / innerHeight 而不用 happy-dom 自己的视口 API：
 * 这里要验的是「收到 resize 之后有没有重新量」，量的正是这两个值。
 */
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}
