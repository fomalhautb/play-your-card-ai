/**
 * 触感能力的网页实现：navigator.vibrate。
 *
 * 网页上只有「震多少毫秒」这一个旋钮，没有 iOS 那套 Taptic Engine 的手感分级，
 * 所以三种反馈只能用不同的时长和节奏近似。数值取的是各家移动端常见做法：
 * 短到几乎只是「碰了一下」，长了会变成恼人的嗡嗡声。
 *
 * iOS Safari 至今不支持 vibrate，所以 iPhone 上这里全是空操作——
 * 真正的触感要等第 36 条接 Capacitor Haptics。
 */

import type { HapticImpact, HapticNotification, HapticsCapability } from '../haptics'

/** 撞击感：越重震得越久。 */
const IMPACT_MS: Record<HapticImpact, number> = { light: 10, medium: 20, heavy: 30 }

/**
 * 结果反馈用节奏区分，不用长短：
 * 成功一下轻的，警告两下，出错三下——不看屏幕也能分出来是哪一种。
 * 数组里奇数位是震动、偶数位是停顿（navigator.vibrate 的约定）。
 */
const NOTIFICATION_PATTERN: Record<HapticNotification, readonly number[]> = {
  success: [15],
  warning: [15, 60, 15],
  error: [15, 60, 15, 60, 15],
}

const SELECTION_MS = 8

export function createWebHaptics(): HapticsCapability {
  return {
    isSupported,
    impact(style = 'medium') {
      vibrate(IMPACT_MS[style])
    },
    selection() {
      vibrate(SELECTION_MS)
    },
    notification(kind) {
      vibrate([...NOTIFICATION_PATTERN[kind]])
    },
  }
}

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

function vibrate(pattern: number | number[]): void {
  if (!isSupported()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // 有的浏览器在没有用户手势时会拒绝震动。触感是锦上添花，失败了就当没有。
  }
}
