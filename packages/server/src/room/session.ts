import type { PlayerId } from '@ai-duel/core'
import type { RoomErrorReason, ServerMessage, SessionRejectedReason } from '@ai-duel/protocol'
import { WIRE_SUBPROTOCOL } from '@ai-duel/protocol'

/**
 * 一条连接自己那点状态：它是谁、坐哪、握手走到哪一步了，以及往它上面发消息。
 *
 * ## 状态挂在连接上，不放内存
 *
 * 房间对象用的是 WebSocket Hibernation（见 MatchRoom.ts）：没有消息进出时对象会被回收，
 * 连接却还开着。内存里的 `Map<WebSocket, ...>` 醒来就是空的，
 * 而 `serializeAttachment` 存的东西由运行时替我们保管，醒来照旧读得到。
 *
 * 所以这里一律走附件，不留任何内存表——这也是旧转发器的做法（它把身份塞在标签里）。
 * 附件是结构化克隆的，只放几个原始值，别往里塞大对象。
 *
 * 座位号另外还挂了一个**标签**，因为「把消息发给 1 号座」只能靠
 * `ctx.getWebSockets(tag)` 反查，附件是查不了的。两处都记同一个座位号，
 * 握手时一起写（见 MatchRoom 的 `fetch`）。
 */

/** 座位标签的前缀。加前缀是留余地：以后再挂别的标签时还认得出哪个是座位。 */
const SEAT_TAG_PREFIX = 'seat:'

/** 房间就两个座位。要「双方各来一遍」时统一走它，别到处写 `[0, 1]`。 */
export const SEATS: readonly PlayerId[] = [0, 1]

/** 一条连接上挂的东西。 */
export interface SessionAttachment {
  /** JWT 验出来的账号 id。客户端说自己是谁不算数。 */
  userId: string
  seat: PlayerId
  /**
   * 收到过版本对得上的 `session:hello` 了没有。
   *
   * 没打过招呼的连接**一条业务消息都不该收到**：它还没确认自己和服务端说的是同一版协议，
   * 这时候发过去的事件它可能根本解析不了（协议 README「协议版本」那一节）。
   */
  greeted: boolean
}

export function seatTag(seat: PlayerId): string {
  return SEAT_TAG_PREFIX + seat
}

export function readSession(ws: WebSocket): SessionAttachment | null {
  return (ws.deserializeAttachment() as SessionAttachment | null) ?? null
}

export function writeSession(ws: WebSocket, session: SessionAttachment): void {
  ws.serializeAttachment(session)
}

/** 往一条连接上发一条协议消息。 */
export function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message))
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
  return ctx.getWebSockets(seatTag(seat)).some((ws) => ws !== exclude)
}

/**
 * 升级成功的 101 响应。
 *
 * **必须回显子协议**：客户端提了 `ai-duel` 和 `jwt.<token>` 两个（见 protocol 的
 * `subprotocolsFor`），浏览器发现响应里选中的子协议不在自己提的名单里会直接判握手失败，
 * 玩家看到的就是一个没有任何细节的 error。回显的是 `ai-duel` 那一个，
 * 绝不能把带 token 的那个回显出去——那等于把凭据写进响应头。
 *
 * 客户端没提子协议时不回显：回一个对方没提过的名字同样是握手失败。
 */
export function upgradeResponse(request: Request, client: WebSocket): Response {
  const offered = request.headers.get('Sec-WebSocket-Protocol') ?? ''
  const accepted = offered.split(',').some((item) => item.trim() === WIRE_SUBPROTOCOL)
  return new Response(null, {
    status: 101,
    webSocket: client,
    ...(accepted ? { headers: { 'Sec-WebSocket-Protocol': WIRE_SUBPROTOCOL } } : {}),
  })
}

/**
 * 握手成功、但业务上不让这个人进：先把 101 回出去，再发一条说明，然后关连接。
 *
 * 为什么不直接回 4xx：浏览器的 WebSocket 对象拿不到失败握手的响应体和状态码，
 * 「房间满了」还是「token 过期了」就没地方说（协议 README「认证」那一节，旧转发器同理）。
 * 所以一律先 101 建起来，把 `session:rejected` 发出去，再带着关闭码关掉——
 * 消息万一没送到，客户端还能从 `CloseEvent.code` 认出大类。
 *
 * 这里用 `accept()` 而不是 `ctx.acceptWebSocket()`：连接马上就关，没有休眠的必要。
 */
export function rejectUpgrade(
  request: Request,
  reason: SessionRejectedReason,
  notice: string,
  closeCode: number,
): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()
  send(server, { type: 'session:rejected', reason, notice })
  server.close(closeCode, reason)
  return upgradeResponse(request, client)
}
