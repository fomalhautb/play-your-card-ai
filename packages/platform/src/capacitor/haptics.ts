/**
 * 触感能力的 Capacitor 实现：转发给 `@capacitor/haptics`。
 *
 * 这一层薄得几乎没有内容，是**故意**的：七项能力里的触感当初就是照这个插件的最小面定的
 * （见 ../haptics.ts 的文件头），所以这里是一一对应的转发，没有任何要翻译的地方。
 *
 * 换掉网页那份的理由是「网页那份在 iPhone 上什么都做不了」：`navigator.vibrate` 至今不被
 * iOS Safari 支持，而 WKWebView 就是 Safari 那个内核。安卓上网页那份能震，但只有
 * 「震多少毫秒」一个旋钮；插件走的是系统的触感 API，轻重和结果类反馈是系统调好的手感。
 */

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import type { HapticImpact, HapticNotification, HapticsCapability } from '../haptics'

const IMPACT: Record<HapticImpact, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
}

const NOTIFICATION: Record<HapticNotification, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
}

export function createCapacitorHaptics(): HapticsCapability {
  return {
    /*
     * 恒为 true。插件没有「这台设备有没有马达」的问句，而手机基本都有；
     * 真没有的时候插件自己不响也不抛，界面上那个「触感反馈」开关照样该摆出来
     * ——玩家关掉它是为了别震，不是为了修一个坏按钮。
     */
    isSupported: () => true,
    impact(style = 'medium') {
      run(Haptics.impact({ style: IMPACT[style] }))
    },
    /*
     * 用 `selectionChanged` 而不是 `selectionStart`/`selectionEnd` 那一对：
     * 那两个是「一串连续选择的开头和结尾」，而这一层只有「划过一格」这一下。
     */
    selection() {
      run(Haptics.selectionChanged())
    },
    notification(kind) {
      run(Haptics.notification({ type: NOTIFICATION[kind] }))
    },
  }
}

/**
 * 插件全是异步的，而这一层的三个方法都是「发出去就不管」。
 *
 * 失败一律吞掉：触感是锦上添花，绝不能因为它没震成而让调用方那一步流程断掉
 * （见 ../haptics.ts 的文件头）。不吞的话这里会变成一条没人接的 rejected promise。
 */
function run(promise: Promise<void>): void {
  void promise.catch(() => {})
}
