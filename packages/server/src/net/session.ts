/**
 * 大厅和房间共用的那一段连接逻辑：连接上挂什么、怎么发消息、101 怎么回、怎么打招呼。
 *
 * 两个 Durable Object 的握手是**同一套**（协议 README「两条连接」）：JWT 走
 * `Sec-WebSocket-Protocol`、101 只回显 `ai-duel`、拒绝时先 101 再关、
 * 第一条消息必须是 `session:hello` 且版本要对上。差别只有 `session:welcome` 里的
 * `place` 一个字段，所以这一层不认识座位、也不认识队列，
 * 房间那半份特有的（座位标签、按座位发）在 room/session.ts。
 *
 * ## 状态挂在连接上，不放内存
 *
 * 两个对象都用 WebSocket Hibernation（见 MatchRoom.ts）：没有消息进出时对象会被回收，
 * 连接却还开着。内存里的 `Map<WebSocket, ...>` 醒来就是空的，
 * 而 `serializeAttachment` 存的东西由运行时替我们保管，醒来照旧读得到。
 * 附件是结构化克隆的，只放几个原始值，别往里塞大对象。
 */

import type { ServerMessage, SessionRejectedReason, WelcomePlace } from '@ai-duel/protocol'
import {
  CLOSE_PROTOCOL_VERSION,
  CLOSE_SUPERSEDED,
  isProtocolVersionSupported,
  PROTOCOL_VERSION,
  WIRE_SUBPROTOCOL,
} from '@ai-duel/protocol'

/** 一条连接上至少挂着的东西。房间那边还会往里加座位号。 */
export interface Session {
  /** JWT 验出来的账号 id。客户端说自己是谁不算数。 */
  userId: string
  /**
   * 收到过版本对得上的 `session:hello` 了没有。
   *
   * 没打过招呼的连接**一条业务消息都不该收到**：它还没确认自己和服务端说的是同一版协议，
   * 这时候发过去的消息它可能根本解析不了（协议 README「协议版本」那一节）。
   */
  greeted: boolean
}

export function readSession<T extends Session>(ws: WebSocket): T | null {
  return (ws.deserializeAttachment() as T | null) ?? null
}

export function writeSession<T extends Session>(ws: WebSocket, session: T): void {
  ws.serializeAttachment(session)
}

/**
 * 往一条连接上发一条协议消息。**已经关掉的连接直接跳过**。
 *
 * ## 为什么要这道守卫
 *
 * 在 workerd 里，对一条自己调过 `close()` 的连接再 `send()` 会当场抛
 * `TypeError: Can't call WebSocket send() after close()`——不是静默丢弃。
 * 而房间收摊那条路恰好会撞上它：`closeRoom` 先把两个座位的连接都关掉，
 * 再 `await` 撤定时任务和把房间码还给大厅；**记录是调用方在那之后才存盘的**，
 * 于是这中间到达的 `webSocketClose` 事件从 SQLite 读回来的还是一份「没收摊」的记录，
 * 照常去 `broadcastPeer`，一发就发在刚关掉的那两条连接上。
 * 联机端到端跑完时 `wrangler dev` 日志里那两条未捕获错误就是这么来的（一个座位一条）。
 *
 * 守在这一层而不是逐个调用方判：`sendToSeat` / `broadcastPeer` / `sendRoomError` 全从这儿走，
 * 而「连接已经没了」对上面每一层来说都是同一件事——没什么可做的，跳过就是了。
 *
 * 判的是 `!== OPEN` 而不是 `=== CLOSED`：`close()` 之后先进 CLOSING，
 * 只判 CLOSED 的话正好漏掉出问题的那一段。
 */
export function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify(message))
}

/** 这个账号此刻还有没有别的连接开着。 */
export function hasOtherConnection(
  ctx: DurableObjectState,
  tag: string,
  self: WebSocket | null,
): boolean {
  return ctx.getWebSockets(tag).some((ws) => ws !== self)
}

/**
 * 顶掉同一个账号（或同一个座位）留下的旧连接。
 *
 * 调用顺序要紧：**先 accept 新连接再顶旧的**，这样旧连接的 close 回调查
 * 「这个人还有别的连接吗」时能查到新的那条，一次重连就不会被当成掉线
 * （黑客松那版转发器踩过这个坑：它先顶旧的再 accept，一次重连被当成掉线通知了对面。）
 */
export function supersede(
  ctx: DurableObjectState,
  tag: string,
  keep: WebSocket,
  notice: string,
): void {
  for (const stale of ctx.getWebSockets(tag)) {
    if (stale === keep) continue
    send(stale, { type: 'session:rejected', reason: 'superseded', notice })
    stale.close(CLOSE_SUPERSEDED, 'superseded')
  }
}

/**
 * 回应 `session:hello`：版本对得上就记下「打过招呼了」并回 `session:welcome`，返回 true；
 * 对不上就发 `session:rejected` 并关连接，返回 false。
 *
 * 版本比对放在第一条消息而不是子协议名里，就是为了这一刻能把「请刷新页面」说出口
 * （见 protocol 的 version.ts）。`place` 由调用方给：大厅给 `{kind:'lobby'}`，
 * 房间给带房间码和座位号的那个。
 */
export function greet<T extends Session>(
  ws: WebSocket,
  session: T,
  clientVersion: number,
  place: WelcomePlace,
): boolean {
  if (!isProtocolVersionSupported(clientVersion)) {
    send(ws, {
      type: 'session:rejected',
      reason: 'protocol-version',
      notice: '客户端版本太旧了，请刷新页面',
    })
    ws.close(CLOSE_PROTOCOL_VERSION, 'protocol-version')
    return false
  }
  writeSession(ws, { ...session, greeted: true })
  send(ws, {
    type: 'session:welcome',
    protocolVersion: PROTOCOL_VERSION,
    userId: session.userId,
    place,
  })
  return true
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
 * 「房间满了」还是「token 过期了」就没地方说（协议 README「认证」那一节）。
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
