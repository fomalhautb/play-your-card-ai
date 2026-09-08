/**
 * 全屏能力的假实现：支持什么、现在是不是全屏，全部由测试摆布。
 *
 * 存在的理由是这一项在不同设备上差得最远（安卓能全屏能锁方向、iPad 只能全屏、
 * iPhone 两样都不行），而界面要按这三种情况给出三套样子。真机上一个个试太贵，
 * 用假实现摆出三种组合，界面分支就能全测到。
 */

import type { FullscreenCapability } from '../fullscreen'
import { createSignal } from '../listeners'

export interface FakeFullscreen extends FullscreenCapability {
  setSupported(supported: boolean): void
  setCanLockOrientation(can: boolean): void
  setStandalone(standalone: boolean): void
  /** 从外面改全屏状态，模拟玩家按了浏览器自己的全屏入口或者按 Esc 退出。 */
  setActive(active: boolean): void
  /** enterLandscape 被调了几次。 */
  enterCount(): number
}

export function createFakeFullscreen(): FakeFullscreen {
  const changed = createSignal<boolean>()
  let supported = true
  let canLock = true
  let standalone = false
  let active = false
  let enters = 0

  function setActive(next: boolean): void {
    if (active === next) return
    active = next
    changed.emit(next)
  }

  return {
    isSupported: () => supported,
    canLockOrientation: () => canLock,
    isActive: () => active,
    onChange: (listener) => changed.add(listener),
    enterLandscape() {
      enters += 1
      // 做不到全屏的设备上返回 false 而不是抛错，和真实现一样：
      // 调用方那一步流程不该因为少了个锦上添花就断掉。
      if (!supported) return Promise.resolve(false)
      setActive(true)
      return Promise.resolve(true)
    },
    exit() {
      setActive(false)
      return Promise.resolve()
    },
    isStandalone: () => standalone,

    setSupported(next) {
      supported = next
    },
    setCanLockOrientation(next) {
      canLock = next
    },
    setStandalone(next) {
      standalone = next
    },
    setActive,
    enterCount: () => enters,
  }
}
