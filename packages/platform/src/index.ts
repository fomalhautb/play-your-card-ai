/**
 * 平台能力接口，以及它们的实现。
 *
 * 网络、音频、存储、图片加载、全屏、安全区、触感都从这里走。场景和界面代码不直接碰
 * 浏览器对象，换平台时只换实现（见《正式版架构》第 2 节第 5 条）。
 * 允许依赖：无。它是被 `canvas`、`ui`、`client`、`bench` 依赖的底层包。
 *
 * 现在有四套实现，三套在这个入口里：
 * - `createWebPlatform()`：浏览器实现。
 * - `createElectronPlatform()`：Steam 壳用的那一套（迁移第 35 条）。它以网页实现为底，
 *   只换掉窗口才管得了的全屏和触感，再补上第八项 `steam`。
 * - `createFakePlatform()`：给测试和 bench 剧本用，不碰任何浏览器 API。
 *
 * 第四套 **`createCapacitorPlatform()` 不在这里**，在子路径入口 `@ai-duel/platform/capacitor`
 *（迁移第 36 条）。理由只有一条：它 import 了 `@capacitor/core`，而那个包是有副作用的
 *（模块一加载就往 window 上挂东西），摇不掉。放在主入口的话，网页壳的产物里会白白多出
 * 一份用不到的 Capacitor 运行时——实测 `apps/web` 因此多 8.2 kB（gzip 后 3.1 kB）。
 * 换成子路径之后只有手机壳那条路径会碰到它。谁也别把它再加回这个文件。
 *
 * 接口本身是平台无关的：不出现 window、document、HTMLElement 这类类型，
 * 订阅一律「传回调、返回退订函数」。
 */

export type { AudioCapability, Playback, PlayOptions, SoundSpec } from './audio'
export type { ShellBridge, ShellFullscreenBridge, ShellSteamBridge } from './electron/bridge'
export { createElectronPlatform } from './electron/index'
export type { FakeAudio, FakeAudioCall } from './fake/audio'
export type { FakeFullscreen } from './fake/fullscreen'
export type { FakeHapticCall, FakeHaptics } from './fake/haptics'
export type { FakeImages } from './fake/images'
export type { FakePlatform } from './fake/index'
export { createFakePlatform } from './fake/index'
export type { FakeNetwork, FakeSocket } from './fake/network'
export type { FakeSafeArea } from './fake/safeArea'
export type { FakeSteam } from './fake/steam'
export type { FakeStorage } from './fake/storage'
export type { FullscreenCapability } from './fullscreen'
export type { HapticImpact, HapticNotification, HapticsCapability } from './haptics'
export type {
  BackgroundLoadOptions,
  ImageLoadProgress,
  ImagesCapability,
  LoadAllOptions,
  LoadedImage,
} from './images'
export type {
  HttpRequestOptions,
  NetworkCapability,
  SocketCloseInfo,
  SocketHandle,
  SocketOptions,
  SocketState,
} from './network'
export type { Platform } from './platform'
export type {
  SafeAreaCapability,
  SafeAreaInsets,
  ScreenOrientation,
  ViewportMetrics,
} from './safeArea'
export type { SteamCapability } from './steam'
export type { StorageCapability, StorageSlot } from './storage'
export { storageKeyOf } from './storage'
export type { WebPlatformOptions } from './web/index'
export { createWebPlatform } from './web/index'
