/**
 * 触感能力的 Electron 实现：全是空操作。
 *
 * 桌面上没有可震的东西——键盘鼠标不会震，手柄震动要走 Steam Input 那一套，
 * 和「卡牌落位轻轻一下」完全不是同一种反馈。
 *
 * 不沿用网页那一份是因为它会去问 `navigator.vibrate`：Chromium 里这个方法**在**，
 * 调用也不报错，只是什么都不发生。那样 `isSupported()` 会回 true，
 * 设置页于是给玩家摆出一个按了毫无反应的「触感反馈」开关。
 */

import type { HapticsCapability } from '../haptics'

export function createElectronHaptics(): HapticsCapability {
  return {
    isSupported: () => false,
    impact() {},
    selection() {},
    notification() {},
  }
}
