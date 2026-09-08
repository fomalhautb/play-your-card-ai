/**
 * 平台能力接口，以及它们的实现。
 *
 * 网络、音频、存储、图片加载、全屏、安全区、触感都从这里走。场景和界面代码不直接碰
 * 浏览器对象，换平台时只换实现（见《正式版架构》第 2 节第 5 条）。
 * 允许依赖：无。它是被 `canvas`、`ui`、`client`、`bench` 依赖的底层包。
 *
 * 现在有两套实现：
 * - `createWebPlatform()`：浏览器实现。Electron 和 Capacitor 目前也用它——
 *   两个壳底下都是完整的浏览器引擎，壳专有的部分留到迁移第 35、36 条再补。
 * - `createFakePlatform()`：给测试和 bench 剧本用，不碰任何浏览器 API。
 *
 * 接口本身是平台无关的：不出现 window、document、HTMLElement 这类类型，
 * 订阅一律「传回调、返回退订函数」。
 */

export type { AudioCapability, Playback, PlayOptions, SoundSpec } from './audio'
export type { FakeAudio, FakeAudioCall } from './fake/audio'
export type { FakeFullscreen } from './fake/fullscreen'
export type { FakeHapticCall, FakeHaptics } from './fake/haptics'
export type { FakeImages } from './fake/images'
export type { FakePlatform } from './fake/index'
export { createFakePlatform } from './fake/index'
export type { FakeNetwork, FakeSocket } from './fake/network'
export type { FakeSafeArea } from './fake/safeArea'
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
export type { StorageCapability, StorageSlot } from './storage'
export { storageKeyOf } from './storage'
export type { WebPlatformOptions } from './web/index'
export { createWebPlatform } from './web/index'
