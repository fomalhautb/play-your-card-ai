/**
 * 触感能力的假实现：只把每一次调用记下来。
 *
 * 震动没法自动验，能验的是「该震的时候有没有调、调的是哪一种」。
 * 设备不支持时不记账——真实现那时是空操作，测试要能看出这两种情况的区别。
 */

import type { HapticImpact, HapticNotification, HapticsCapability } from '../haptics'

export type FakeHapticCall =
  | { kind: 'impact'; style: HapticImpact }
  | { kind: 'selection' }
  | { kind: 'notification'; notification: HapticNotification }

export interface FakeHaptics extends HapticsCapability {
  /** 按发生顺序记下的每一次调用。 */
  readonly calls: readonly FakeHapticCall[]
  setSupported(supported: boolean): void
}

export function createFakeHaptics(): FakeHaptics {
  const calls: FakeHapticCall[] = []
  let supported = true

  return {
    calls,
    isSupported: () => supported,
    impact(style = 'medium') {
      if (supported) calls.push({ kind: 'impact', style })
    },
    selection() {
      if (supported) calls.push({ kind: 'selection' })
    },
    notification(notification) {
      if (supported) calls.push({ kind: 'notification', notification })
    },
    setSupported(next) {
      supported = next
    },
  }
}
