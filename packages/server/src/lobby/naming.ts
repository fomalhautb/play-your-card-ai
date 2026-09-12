/**
 * 大厅这边的两个名字。单独一个文件是为了**不让别处 import 大厅那个类**：
 * 房间收摊时要调大厅的 `release`（见 room/lifecycle.ts），它只需要这个名字，
 * 从 Lobby.ts 里取的话两个目录就互相 import 上了（biome 的 noImportCycles 会卡）。
 */

/**
 * 大厅 Durable Object 的实例名。**全局只有这一个大厅**（《正式版架构》5.4）：
 * 匹配队列要凑一对人，分成多个实例就等于把队列切碎，人少的时候永远配不上。
 * 路由和房间都用 `getByName(LOBBY_NAME)` 找它。
 */
export const LOBBY_NAME = 'global'

/**
 * 大厅连接按账号打的标签。
 *
 * 配对成功时要给「队列里另一个人」发房间码，而他不在当前这条消息的处理路径上，
 * 只能靠 `ctx.getWebSockets(tag)` 反查——附件是查不了的（见 net/session.ts）。
 * 加前缀是留余地：以后再挂别的标签时还认得出哪个是账号。
 */
export function userTag(userId: string): string {
  return `user:${userId}`
}
