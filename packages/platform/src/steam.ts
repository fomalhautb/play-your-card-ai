/**
 * Steam 能力：这台机器上的 Steam 客户端，以及问它要一张证明「我是这个 Steam 账号」的票据。
 *
 * 它和另外七项不一样，是**可选的**（`Platform.steam` 可以是 undefined）：
 * 七项能力每个壳都有，只是实现不同；Steam 只有 Steam 那个壳有，网页和手机壳根本没有对应的东西。
 * 写成「可选的第八项」而不是「让另外两个壳返回一个假的」，是因为界面要分的正是
 * 「有没有 Steam」这件事——给个恒假的实现，调用方就得改成问 `isAvailable()`，
 * 而那时又分不出「装了 Steam 但没开」和「这个壳压根不是 Steam 版」。
 *
 * 票据怎么用见《正式版架构》5.5：客户端拿它换服务端的会话，服务端拿它去问 Steam
 *「这张票是谁的」（`packages/server/src/auth/steamTicket.ts`）。
 * 客户端自己说的 steamId 一律不算数——票据是唯一的凭据。
 */

export interface SteamCapability {
  /**
   * Steam 客户端在不在、SDK 初始化成功没有。
   *
   * 同步的：壳在开窗口之前就初始化完了，结果随进程固定不变（见 apps/steam/src/steam.ts）。
   * 玩家在游戏中途退出 Steam 客户端时这个值不会变——那种情况下 `authTicket()` 会失败，
   * 由调用方那一处 catch 兜住，不值得为它加一套订阅。
   */
  isAvailable(): boolean
  /**
   * 现取一张会话票据，十六进制字符串，直接发给服务端。
   *
   * **每次现取，不缓存**：票据是一次性的（服务端验过就作废），而且有有效期。
   * Steam 客户端没在跑、或者这个 appId 没有权限时抛错。
   */
  authTicket(): Promise<string>
  /**
   * Steam 上的昵称，账号页拿它显示「你是谁」。
   *
   * **只给人看**：服务端不信这个值，它那边的昵称是自己从 Steam 验票据时拿到的。
   * 拿不到时是 null。
   */
  personaName(): string | null
}
