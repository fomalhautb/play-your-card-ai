/**
 * 全屏能力：进全屏，并尽量把屏幕锁成横屏。
 *
 * 为什么这两件事绑在一起（旧代码 legacy-client/src/ui/fullscreen.ts）：
 * 手机浏览器的地址栏和底栏吃掉的是高度，而横版游戏正好被高度卡住，少一条栏画面就大一圈；
 * 更要紧的是**只有进了全屏，浏览器才允许锁定屏幕方向**——这是唯一能压过系统「竖排方向锁定」
 * 的办法，开了旋转锁定的玩家光转手腕是没用的。
 *
 * 各平台差得很远，所以先问能力再给入口，且一处都不抛错：
 * - 安卓 Chromium 系：两样都行；
 * - iPhone Safari / iOS 里的所有浏览器：非 video 元素不给全屏，也没有方向锁，两个问句都是 false；
 * - iPad Safari：给全屏，不给方向锁；
 * - Electron 和 Capacitor 壳：窗口本来就没有地址栏，`isStandalone()` 为 true，不该再劝玩家全屏。
 */

export interface FullscreenCapability {
  /**
   * 这台设备给不给整页全屏。
   * 界面拿它决定「全屏」入口要不要出现——做不到的地方给按钮只会让人以为按钮坏了。
   */
  isSupported(): boolean
  /**
   * 能不能锁定屏幕方向。
   *
   * 和 isSupported 分开问：iPad 能全屏但锁不了方向，那时按下去画面变大却没转过来。
   * 注意这只是「值不值得把按钮显示出来」的判据，真能不能锁还得看 enterLandscape 的结果。
   */
  canLockOrientation(): boolean
  /** 现在是不是全屏。判的是「有没有东西处于全屏」，玩家自己按浏览器的全屏也算。 */
  isActive(): boolean
  /** 订阅全屏状态变化，返回退订函数。玩家可能走浏览器自己的入口，不能只在按钮回调里记。 */
  onChange(listener: (active: boolean) => void): () => void
  /**
   * 进全屏，然后尽量锁成横屏。
   *
   * **必须在用户手势（点击、触摸）的同步回调里调用**，否则浏览器直接拒绝。
   * 返回值是「有没有真的进到全屏」，方向锁失败不算失败——起码画面大了一圈。
   * 任何一种失败都只是少了个锦上添花，所以这个方法不抛错。
   */
  enterLandscape(): Promise<boolean>
  /** 退出全屏。方向锁会被一并解掉，不用自己管。 */
  exit(): Promise<void>
  /**
   * 已经是没有浏览器界面的启动方式。
   *
   * 网页上指的是 iOS「添加到主屏幕」之后从图标启动，Electron 和 Capacitor 壳里恒为 true。
   * 这种情况下地址栏本来就没有，再劝玩家去全屏就是骚扰。
   */
  isStandalone(): boolean
}
