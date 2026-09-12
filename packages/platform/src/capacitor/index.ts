/**
 * Capacitor 平台：以网页实现为底，换掉在系统 WebView 里会出错的那三项。
 *
 * 「以 web 实现为底」和 Electron 那份同一个理由：Capacitor 套的就是系统 WebView，
 * 音频、存储、图片加载这几项的浏览器实现在这儿全是对的，重写只会多几份要一起维护的代码
 *（见 platform 包的文件头）。换掉的三项：
 * - `network`：地址要改指线上、HTTP 要走原生、前后台要问系统（见 capacitor/network.ts）；
 * - `fullscreen`：全屏是藏系统状态栏和导航栏，不是页面全屏（见 capacitor/fullscreen.ts）；
 * - `haptics`：iPhone 上 `navigator.vibrate` 根本不存在（见 capacitor/haptics.ts）。
 *
 * **`safeArea` 没有换**，虽然它是手机上最要紧的一项。网页那份量的是隐藏探针上的
 * `env(safe-area-inset-*)`，iOS 的 WKWebView 配上 `viewport-fit=cover` 本来就报得准；
 * 安卓 WebView 那边 `env()` 不可靠，但 Capacitor 自己会注入一组 `--safe-area-inset-*`
 * CSS 变量顶上（`plugins.SystemBars.insetsHandling: 'css'`，默认就开着），
 * 而探针两样都读（见 web/safeArea.ts 里那条 padding）。一份实现两边都对，不用再写一份。
 *
 * `steam` 那一项手机上没有，所以是 undefined——和网页壳一样（见 platform.ts 的说明）。
 *
 * 不在原生壳里跑的时候（浏览器里打开同一份产物、测试、组件目录页）退回纯网页实现：
 * 那时 Capacitor 的插件调用全是空操作或者报错，混着用只会得到一堆没人看的异常。
 */

import { Capacitor } from '@capacitor/core'
import type { Platform } from '../platform'
import type { WebPlatformOptions } from '../web/index'
import { createWebPlatform } from '../web/index'
import { createCapacitorFullscreen } from './fullscreen'
import { createCapacitorHaptics } from './haptics'
import { createCapacitorNetwork } from './network'
import { DEFAULT_SITE_ORIGIN } from './origin'

export interface CapacitorPlatformOptions extends WebPlatformOptions {
  /**
   * 服务端在哪个源。默认线上那个。
   *
   * 留这个口子是给预发布用的：同一份构建换个源就能指到别处，和 Steam 壳的
   * `AI_DUEL_ORIGIN` 是同一件事（手机壳里没有环境变量，只能由壳传进来）。
   */
  siteOrigin?: string
}

export function createCapacitorPlatform(options: CapacitorPlatformOptions = {}): Platform {
  const web = createWebPlatform(options)
  if (!Capacitor.isNativePlatform()) return web

  return {
    ...web,
    network: createCapacitorNetwork(web.network, options.siteOrigin ?? DEFAULT_SITE_ORIGIN),
    fullscreen: createCapacitorFullscreen(),
    haptics: createCapacitorHaptics(),
  }
}
