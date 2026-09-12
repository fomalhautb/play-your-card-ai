/**
 * Electron 平台：以网页实现为底，换掉窗口才管得了的那两项，再补上 Steam 那一项。
 *
 * 「以 web 实现为底」不是偷懒：Electron 的渲染进程就是 Chromium，网络、音频、存储、
 * 图片加载、安全区这五项的浏览器实现在这儿全是对的，重写一遍只会多五份要一起维护的代码
 *（见 platform 包的文件头）。真正不一样的只有三项：
 * - `fullscreen`：要全屏的是**窗口**，不是页面里的那一块（见 electron/fullscreen.ts）；
 * - `haptics`：桌面上没有可震的东西，但 `navigator.vibrate` 在 Chromium 里**存在**，
 *   沿用网页实现会让设置页摆出一个按了没反应的开关（见 electron/haptics.ts）；
 * - `steam`：第八项，只有这个壳有。
 *
 * 桥不在的时候（没有 preload——端到端用例、直接用浏览器打开构建产物）退回纯网页实现。
 * 那时 `platform.steam` 是 undefined，客户端于是走游客登录那条路，整个应用照样能跑。
 */

import type { Platform } from '../platform'
import type { WebPlatformOptions } from '../web/index'
import { createWebPlatform } from '../web/index'
import { readShellBridge } from './bridge'
import { createElectronFullscreen } from './fullscreen'
import { createElectronHaptics } from './haptics'
import { createElectronSteam } from './steam'

export function createElectronPlatform(options: WebPlatformOptions = {}): Platform {
  const web = createWebPlatform(options)
  const bridge = readShellBridge()
  if (bridge === null) return web

  return {
    ...web,
    fullscreen: createElectronFullscreen(bridge.fullscreen),
    haptics: createElectronHaptics(),
    steam: createElectronSteam(bridge.steam),
  }
}
