/**
 * 触感能力：手机上那一下轻微的震动反馈。
 *
 * 旧代码一处都没有用过（全站搜不到 navigator.vibrate），所以这份接口不是从旧用法推出来的，
 * 而是照 Capacitor Haptics 插件的最小面来定——iOS 和 Android 上最终要落到它身上，
 * 按它的形状定接口，将来第 36 条写 capacitor 实现时是一一对应的转发，不用改接口。
 *
 * 网页这边只有 navigator.vibrate（iOS Safari 至今不支持），所以三种反馈在网页上
 * 都是不同长度的一下震动，没有系统那种细腻的手感。做不到的地方直接空操作：
 * 触感是锦上添花，绝不能因为它没有就少走一步流程。
 */

/** 撞击感的轻重。对应 Capacitor 的 ImpactStyle。 */
export type HapticImpact = 'light' | 'medium' | 'heavy'

/** 结果类反馈。对应 Capacitor 的 NotificationType。 */
export type HapticNotification = 'success' | 'warning' | 'error'

export interface HapticsCapability {
  /** 这台设备给不给震。设置里那个「触感反馈」开关要拿它决定显不显示。 */
  isSupported(): boolean
  /** 一下撞击感。卡牌落位、按钮按下这类「有东西碰到了」的时刻用。 */
  impact(style?: HapticImpact): void
  /** 选中感，比 impact('light') 还轻。在选项之间划过、目标切换时用。 */
  selection(): void
  /** 结果反馈。出牌被拒、对局结束这类「有个结论了」的时刻用。 */
  notification(kind: HapticNotification): void
}
