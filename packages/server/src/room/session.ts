import type { PlayerId } from '@ai-duel/core'
import type { RoomErrorReason, ServerMessage } from '@ai-duel/protocol'
import { isDevEnv } from '../devMode'
import { hasOtherConnection, readSession, type Session, send } from '../net/session'

/**
 * 房间这一侧特有的连接细节：座位标签、按座位发消息、这个座位在不在线。
 *
 * 通用的那半份（附件怎么存、101 怎么回、怎么打招呼）在 net/session.ts，大厅共用同一份。
 * 这里之所以还要一层座位，是因为「把消息发给 1 号座」只能靠 `ctx.getWebSockets(tag)` 反查，
 * 附件是查不了的。所以座位号在附件和标签里各记一份，握手时一起写（见 MatchRoom 的 `fetch`）。
 */

/** 座位标签的前缀。加前缀是留余地：以后再挂别的标签时还认得出哪个是座位。 */
const SEAT_TAG_PREFIX = 'seat:'

/** 房间就两个座位。要「双方各来一遍」时统一走它，别到处写 `[0, 1]`。 */
export const SEATS: readonly PlayerId[] = [0, 1]

/** 房间连接的附件：通用那几项，加一个座位号。 */
export interface RoomSession extends Session {
  seat: PlayerId
}

export function seatTag(seat: PlayerId): string {
  return SEAT_TAG_PREFIX + seat
}

/**
 * 这一条没被接受，但连接不关（协议 README 的 `room:error`）。
 *
 * 只回给发消息那一方：出错的是他发的东西，对手不需要知道。
 */
export function sendRoomError(ws: WebSocket, reason: RoomErrorReason, notice: string): void {
  send(ws, { type: 'room:error', reason, notice })
}

/**
 * `malformed`：整条消息连 schema 都没过，**只在开发模式下回**（协议的 `roomErrorReasonSchema`）。
 *
 * 线上告诉对方「你发的东西我没看懂」除了帮他调试没有别的用处：正常客户端不会发出
 * 过不了 schema 的消息，会发的只有在试探协议边界的人。开发时反过来——静默丢弃会让
 * 「消息发错了」和「服务端没反应」长得一模一样，那是最难查的一类问题。
 * 「现在算不算开发环境」的判据见 devMode.ts。
 */
export function sendMalformed(env: Env, ws: WebSocket, notice: string): void {
  if (!isDevEnv(env)) return
  sendRoomError(ws, 'malformed', notice)
}

/**
 * 发给某个座位**已经打完招呼**的每一条连接。
 *
 * 正常情况下一个座位只有一条连接（新连接会顶掉旧的），但顶掉是异步的：
 * 旧连接的 close 回调还没到时，两条会短暂并存。都发一份比挑一条更简单也更安全——
 * 多发一份到马上就要断的连接没有害处，漏发才会让玩家的界面停在半路。
 */
export function sendToSeat(ctx: DurableObjectState, seat: PlayerId, message: ServerMessage): void {
  for (const ws of ctx.getWebSockets(seatTag(seat))) {
    if (readSession(ws)?.greeted === true) send(ws, message)
  }
}

/**
 * 这个座位此刻有没有人连着。`room:peer` 的 `online` 就是它。
 *
 * 只看「有没有开着的连接」，不看打没打招呼：刚连上还没发 `session:hello` 的那一小段
 * 算在线更贴近事实，也避免重连时对手界面闪一下「对方掉线」。
 *
 * `exclude` 是给关闭回调用的：`webSocketClose` 跑的时候，正在关的那条连接可能还在
 * `getWebSockets()` 的结果里，不排掉就会算出「他还在线」。
 */
export function seatOnline(
  ctx: DurableObjectState,
  seat: PlayerId,
  exclude: WebSocket | null = null,
): boolean {
  return hasOtherConnection(ctx, seatTag(seat), exclude)
}
