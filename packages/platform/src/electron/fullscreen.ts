/**
 * 全屏能力的 Electron 实现：不走浏览器的 Fullscreen API，走窗口本身。
 *
 * 为什么不沿用网页那一份：`document.requestFullscreen()` 在 Electron 里能用，但它全屏的是
 * **页面在窗口里的那一块**，窗口的标题栏和边框还在；而这里要的是「整块屏幕只有游戏」，
 * 那是 `BrowserWindow.setFullScreen()` 的事，只有主进程做得到。
 * 另外玩家按 F11、点窗口自己的全屏按钮、或者在 macOS 上用触发角退出时，
 * 浏览器那套 `fullscreenchange` 事件一声不响——状态必须由主进程推过来。
 *
 * 方向锁在桌面上没有意义（屏幕不会转），所以 `canLockOrientation()` 恒为 false；
 * `isStandalone()` 恒为 true——窗口本来就没有地址栏，不该再劝玩家去全屏。
 */

import type { FullscreenCapability } from '../fullscreen'
import type { ShellFullscreenBridge } from './bridge'

export function createElectronFullscreen(bridge: ShellFullscreenBridge): FullscreenCapability {
  return {
    isSupported: () => true,
    canLockOrientation: () => false,
    isActive: () => bridge.isActive(),
    onChange: (listener) => bridge.onChange(listener),
    async enterLandscape() {
      try {
        return await bridge.set(true)
      } catch {
        // 和网页那一份同一条纪律：全屏是锦上添花，失败了只返回 false，不抛错。
        return false
      }
    },
    async exit() {
      try {
        await bridge.set(false)
      } catch {
        // 退不出全屏不是调用方能处理的事。
      }
    },
    isStandalone: () => true,
  }
}
