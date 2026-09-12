/**
 * 全屏能力的 Capacitor 实现：全屏 = 把系统状态栏和导航栏藏起来。
 *
 * 为什么不沿用网页那份：WebView 里 `document.requestFullscreen()` 管的是页面在 WebView 里的
 * 那一块，而 WebView 本来就铺满了整个应用窗口——调了什么也看不出来。真正挡住画面的是
 * 系统那两条栏，藏它们要走原生，也就是 `@capacitor/core` 自带的 SystemBars（不是插件，在核心里）。
 *
 * 两条恒定值：
 * - `canLockOrientation()` 恒为 false。方向**不是运行时锁的**，是原生工程里写死的
 *   （AndroidManifest 的 `android:screenOrientation`、Info.plist 的 `UISupportedInterfaceOrientations`，
 *   见 apps/mobile/README.md）。写死比运行时锁可靠：应用从启动第一帧就是横的，
 *   不会先竖着画一帧再转过来。既然锁不掉也不用锁，这里就该老实说「没有这个能力」——
 *   竖屏提示那颗「一键横屏」按钮于是不出现（见 client 的 OrientationNotice.tsx），
 *   而它本来也没有用武之地：屏幕根本转不到竖的。
 * - `isStandalone()` 恒为 true。手机壳里没有地址栏，不该再劝玩家去全屏
 *   （见 client 的 FullscreenEntry.tsx）。
 *
 * 初值是「已经全屏」：两条栏在应用启动时就藏好了，由 capacitor.config.ts 里
 * `plugins.SystemBars.hidden` 那条声明式地做掉，不用壳里写一行代码。
 */

import { SystemBars } from '@capacitor/core'
import type { FullscreenCapability } from '../fullscreen'
import { createSignal } from '../listeners'

export function createCapacitorFullscreen(): FullscreenCapability {
  const changed = createSignal<boolean>()
  /**
   * 现在两条栏藏没藏。自己记着，因为 SystemBars 没有「现在是藏是显」的问句。
   *
   * 记一份的代价是「玩家从屏幕边缘划出系统栏」这种情况这里不知道——那是系统的临时手势，
   * 手一松就自己收回去，应用状态并没有变，不值得为它接一套原生事件。
   */
  let active = true

  function set(next: boolean): void {
    if (active === next) return
    active = next
    changed.emit(next)
  }

  return {
    isSupported: () => true,
    canLockOrientation: () => false,
    isActive: () => active,
    onChange: (listener) => changed.add(listener),
    async enterLandscape() {
      try {
        await SystemBars.hide()
      } catch {
        // 和网页那份同一条纪律：全屏是锦上添花，失败了只返回 false，不抛错。
        return false
      }
      set(true)
      return true
    },
    async exit() {
      try {
        await SystemBars.show()
      } catch {
        // 藏都藏上了还显不出来，不是调用方能处理的事。
        return
      }
      set(false)
    },
    isStandalone: () => true,
  }
}
