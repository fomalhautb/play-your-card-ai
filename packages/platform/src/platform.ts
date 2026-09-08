/**
 * 七项平台能力打成一个包。
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
import type { StorageCapability } from './storage'

export interface Platform {
  network: NetworkCapability
  audio: AudioCapability
  storage: StorageCapability
  images: ImagesCapability
  fullscreen: FullscreenCapability
  safeArea: SafeAreaCapability
  haptics: HapticsCapability
}
