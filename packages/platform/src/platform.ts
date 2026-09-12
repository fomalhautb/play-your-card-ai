/**
 * 七项平台能力打成一个包，外加一项只有某些壳才有的。
 *
 * 场景和界面代码只认这一个对象，谁都不去 import 具体实现——换平台时只换构造函数
 *（见《正式版架构》第 2 节第 5 条）。构造在应用入口做一次，往下一路传。
 */

import type { AudioCapability } from './audio'
import type { FullscreenCapability } from './fullscreen'
import type { HapticsCapability } from './haptics'
import type { ImagesCapability } from './images'
import type { NetworkCapability } from './network'
import type { SafeAreaCapability } from './safeArea'
import type { SteamCapability } from './steam'
import type { StorageCapability } from './storage'

export interface Platform {
  network: NetworkCapability
  audio: AudioCapability
  storage: StorageCapability
  images: ImagesCapability
  fullscreen: FullscreenCapability
  safeArea: SafeAreaCapability
  haptics: HapticsCapability
  /**
   * Steam（迁移第 35 条）。**只有 Steam 那个壳有**，网页和手机壳这一项是 undefined。
   *
   * 前面七项是必填的：它们每个壳都有，只是实现不同。Steam 不是——网页上根本没有对应的东西。
   * 所以它写成可选，而不是给另外两个壳配一个「恒说没有」的假实现：
   * 那样调用方分不出「装了 Steam 但没开」和「这个壳压根不是 Steam 版」，
   * 而这两种情况界面上要说的话不一样（见 steam.ts 的文件头）。
   */
  steam?: SteamCapability
}
