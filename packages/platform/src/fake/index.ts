/**
 * 假平台：七项能力全部换成不碰任何浏览器 API 的版本，给测试和 bench 用。
 *
 * 两类用处：
 * 1. 测试。不用起浏览器就能把「断线之后有没有重连」「这一步该不该响」「存档版本换了
 *    还读不读得到」跑出来，而且每一步的时机由脚本控制，不看运气。
 * 2. bench 的剧本（第 2 条）。性能剧本要的是稳定可复现，网络和音频的真实抖动只会
 *    污染帧时间，用假的正好。
 *
 * 返回类型是 FakePlatform 而不是 Platform：每一项都在接口之外多出几个操纵用的方法，
 * 直接标成 Platform 的话它们就被类型挡住了。需要按接口传给被测代码时它照样是 Platform。
 */

import type { Platform } from '../platform'
import type { FakeAudio } from './audio'
import { createFakeAudio } from './audio'
import type { FakeFullscreen } from './fullscreen'
import { createFakeFullscreen } from './fullscreen'
import type { FakeHaptics } from './haptics'
import { createFakeHaptics } from './haptics'
import type { FakeImages } from './images'
import { createFakeImages } from './images'
import type { FakeNetwork } from './network'
import { createFakeNetwork } from './network'
import type { FakeSafeArea } from './safeArea'
import { createFakeSafeArea } from './safeArea'
import type { FakeSteam } from './steam'
import { createFakeSteam } from './steam'
import type { FakeStorage } from './storage'
import { createFakeStorage } from './storage'

export interface FakePlatform extends Platform {
  network: FakeNetwork
  audio: FakeAudio
  storage: FakeStorage
  images: FakeImages
  fullscreen: FakeFullscreen
  safeArea: FakeSafeArea
  haptics: FakeHaptics
  /**
   * 真 Platform 上这一项是可选的，假平台上**一定**有一份——测试要能随手把它打开。
   * 它默认 `isAvailable()` 是 false，所以「有这个对象」不等于「这台假机器上有 Steam」
   *（见 fake/steam.ts）。
   */
  steam: FakeSteam
}

export function createFakePlatform(): FakePlatform {
  return {
    network: createFakeNetwork(),
    audio: createFakeAudio(),
    storage: createFakeStorage(),
    images: createFakeImages(),
    fullscreen: createFakeFullscreen(),
    safeArea: createFakeSafeArea(),
    haptics: createFakeHaptics(),
    steam: createFakeSteam(),
  }
}
