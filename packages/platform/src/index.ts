/**
 * 平台能力接口，以及它们的实现。
 *
 * 网络、音频、存储、图片加载、全屏、安全区、触感都从这里走。场景和界面代码不直接碰
 * 浏览器对象，换平台时只换实现（见《正式版架构》第 2 节第 5 条）。
 * 允许依赖：无。它是被 `canvas`、`ui`、`client`、`bench` 依赖的底层包。
 *
 * 现在有四套实现：
 * - `createWebPlatform()`：浏览器实现。
 * - `createElectronPlatform()`：Steam 壳用的那一套（迁移第 35 条）。它以网页实现为底，
 *   只换掉窗口才管得了的全屏和触感，再补上第八项 `steam`。
 * - `createCapacitorPlatform()`：iOS / Android 壳用的那一套（迁移第 36 条）。同样以网页实现
 *   为底，换掉网络（地址指线上、HTTP 走原生）、全屏（藏系统栏）和触感（原生触感）三项。
 * - `createFakePlatform()`：给测试和 bench 剧本用，不碰任何浏览器 API。
 *
 * 接口本身是平台无关的：不出现 window、document、HTMLElement 这类类型，
 * 订阅一律「传回调、返回退订函数」。
 */

export type { AudioCapability, Playback, PlayOptions, SoundSpec } from './audio'
export type { CapacitorPlatformOptions } from './capacitor/index'
export { createCapacitorPlatform } from './capacitor/index'
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
