/**
 * 网页平台：七项能力的浏览器实现装成一个 Platform。
 *
 * 三个壳目前都走这一套——Electron 的渲染进程是 Chromium，Capacitor 是系统 WebView，
 * 浏览器 API 都在。第 35、36 条会给它们各自补上壳专有的部分（Steam 覆盖层、原生触感、
 * 系统安全区），到那时是「以 web 实现为底，换掉其中几项」，不是另起一套。
 */

import type { Platform } from '../platform'
import { createWebAudio } from './audio'
import { createWebFullscreen } from './fullscreen'
import { createWebHaptics } from './haptics'
import { createWebImages } from './images'
import type { WebNetworkOptions } from './network'
import { createWebNetwork } from './network'
import { createWebSafeArea } from './safeArea'
import { createWebStorage } from './storage'

export interface WebPlatformOptions {
  network?: WebNetworkOptions
}

export function createWebPlatform(options: WebPlatformOptions = {}): Platform {
  return {
    network: createWebNetwork(options.network),
    audio: createWebAudio(),
    storage: createWebStorage(),
    images: createWebImages(),
    fullscreen: createWebFullscreen(),
    safeArea: createWebSafeArea(),
    haptics: createWebHaptics(),
  }
}
