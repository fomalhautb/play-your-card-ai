/**
 * 安全区与视口能力的假实现：一份可以随手改的快照。
 *
 * 默认值取 iPhone 11 横屏（1792×828 的物理分辨率按 2 倍 dpr 算成 896×414），
 * 左右各让开 44——刘海和圆角在横屏时挪到了两侧。性能基线设备之一就是它，
 * 拿它当默认值，写测试时不用每次都摆一遍参数。
 */

import { createSignal } from '../listeners'
import type { SafeAreaCapability, ViewportMetrics } from '../safeArea'

const IPHONE_11_LANDSCAPE: ViewportMetrics = {
  width: 896,
  height: 414,
  insets: { top: 0, right: 44, bottom: 21, left: 44 },
  orientation: 'landscape',
  pixelRatio: 2,
}

export interface FakeSafeArea extends SafeAreaCapability {
  /**
   * 改其中几项，其余保持不变。值真的变了才会通知订阅者——
   * 这条规矩接口上写着，假实现也得守，不然测不出「同一个尺寸报了两遍」这类问题。
   */
  set(patch: Partial<ViewportMetrics>): void
  setCoarsePointer(coarse: boolean): void
}

export function createFakeSafeArea(): FakeSafeArea {
  const changed = createSignal<ViewportMetrics>()
  let current: ViewportMetrics = IPHONE_11_LANDSCAPE
  let coarse = true

  return {
    metrics: () => current,
    onChange: (listener) => changed.add(listener),
    isCoarsePointer: () => coarse,

    set(patch) {
      const next: ViewportMetrics = {
        ...current,
        ...patch,
        insets: { ...current.insets, ...patch.insets },
      }
      if (same(current, next)) return
      current = next
      changed.emit(next)
    },
    setCoarsePointer(next) {
      coarse = next
    },
  }
}

function same(a: ViewportMetrics, b: ViewportMetrics): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.orientation === b.orientation &&
    a.pixelRatio === b.pixelRatio &&
    a.insets.top === b.insets.top &&
    a.insets.right === b.insets.right &&
    a.insets.bottom === b.insets.bottom &&
    a.insets.left === b.insets.left
  )
}
