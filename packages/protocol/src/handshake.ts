/**
 * 连接这一层：怎么带 JWT 上来、版本怎么对、心跳发什么、关连接用哪个码。
 *
 * ## JWT 走 `Sec-WebSocket-Protocol`，不走 URL 参数，也不走第一条消息
 *
 * 《正式版架构》5.5 要求「WebSocket 升级请求带 JWT」。升级请求上能塞东西的地方只有三处，
 * 挑子协议头是权衡下来最好的一处：
 *
 * - **自定义 header（`Authorization`）**：Durable Object 读得到，但浏览器的 `WebSocket`
 *   构造函数根本没有设 header 的入口。四个平台里有三个跑在 WebView 上（需求第 1 条），
 *   这条路直接断。
 * - **URL 查询参数**（旧转发器的 `?peer=` 就是这么干的）：能用，但 token 会进
 *   Cloudflare 的请求日志、浏览器历史和各级中间设备的访问日志。JWT 是**凭据**，
 *   和 peer id 那种无所谓的东西不是一回事。
 * - **连上之后第一条消息认证**：也能用，代价是服务端得容忍一段「已连接但没身份」的窗口
 *   （要配超时、要防有人挂着不认证占连接），而且 DO 的 hibernation 醒来后还得记得
 *   这条连接认没认过。多一个状态就多一处会错。
 * - **`Sec-WebSocket-Protocol`（选它）**：浏览器的 `new WebSocket(url, protocols)`
 *   第二个参数就是它，唯一一个各平台都能设的请求头；服务端在 101 响应里回显选中的子协议。
 *   JWT 的紧凑序列化只有 base64url 字符和点，正好都是 RFC 7230 允许的 token 字符，
 *   不用再编一层码。客户端用的 partysocket 支持把 protocols 写成函数
 *   （`ProtocolsProvider`），每次重连现取一遍，短时效 token 因此能自动续上。
 *
 * 客户端提两个子协议：`WIRE_SUBPROTOCOL` 和 `jwt.<token>`；服务端**只回显前者**。
 * 必须回显：浏览器发现响应里的子协议不在自己提的名单里会直接判握手失败。
 *
 * 剩下的风险照旧：子协议头同样可能被中间设备记进日志，所以 JWT 要短时效
 * （几分钟级、由 better-auth 签发），泄漏了也很快作废。
 *
 * ## 版本对不上怎么办
 *
 * 见 version.ts：子协议名里**故意不带版本号**，版本比对放在第一条消息，
 * 好让服务端能把「请刷新页面」这句话说出口。
 */

import { z } from 'zod'
import { noticeSchema, playerIdSchema, roomCodeSchema } from './common'
import { PROTOCOL_VERSION } from './version'

/**
 * WebSocket 子协议名。客户端提它，服务端回显它。
 *
 * 不带版本号，理由见 version.ts。
 */
export const WIRE_SUBPROTOCOL = 'ai-duel'

/**
 * 带 JWT 的那个子协议名的前缀。
 *
 * 用 `.` 当分隔符而不是 `:`：子协议名要符合 RFC 7230 的 token 语法，冒号不在允许的字符里，
 * 而点号在（JWT 自己也是拿点分段的）。
 */
export const AUTH_SUBPROTOCOL_PREFIX = 'jwt.'

/**
 * 客户端 `new WebSocket(url, protocols)` 第二个参数该传什么。
 *
 * 两端都从这里取，省得一边写 `jwt.` 另一边写 `jwt-` 这种事。
 */
export function subprotocolsFor(token: string): [string, string] {
  return [WIRE_SUBPROTOCOL, AUTH_SUBPROTOCOL_PREFIX + token]
}

/**
 * 从升级请求的 `Sec-WebSocket-Protocol` 头里把 JWT 抠出来，没有就返回 null。
 *
 * 头的值是逗号分隔的子协议名列表，中间允许有空格。找不到带前缀的那一项、
 * 或者前缀后面是空的，都当成「没带 token」——服务端据此回 `CLOSE_UNAUTHORIZED`。
 */
export function authTokenFrom(header: string | null | undefined): string | null {
  if (!header) return null
  for (const raw of header.split(',')) {
    const item = raw.trim()
    if (!item.startsWith(AUTH_SUBPROTOCOL_PREFIX)) continue
    const token = item.slice(AUTH_SUBPROTOCOL_PREFIX.length)
    if (token.length > 0) return token
  }
  return null
}

/**
 * 心跳。**不是 JSON 消息**，就是这两个裸字符串。
 *
 * 这么定是为了配合 Durable Object 的 `setWebSocketAutoResponse`：
 * 给它一对固定的请求/应答字符串之后，DO 在休眠中收到 `ping` 会由运行时直接回 `pong`，
 * 既不唤醒对象也不计费（旧转发器已经这么用了，见 packages/server 的构造函数）。
 * 自动应答只认逐字节相等的字符串，所以这一对绝不能包成 JSON。
 *
 * 客户端定期发 `ping` 有两个用处：保住中间链路上的空闲连接不被运营商掐掉，
 * 以及靠「发了 ping 却等不到 pong」识破半开连接（socket 看着还开着，数据其实出不去）。
 *
 * 因此 `parseClientMessage` 解析 `'ping'` 会失败，这是**正常的**：
 * 这两个字符串根本走不到消息解析那一步。收消息的地方要先把它们挑出去。
 */
export const HEARTBEAT_PING = 'ping'
export const HEARTBEAT_PONG = 'pong'

/**
 * 关连接用的码。4000–4999 是 WebSocket 留给应用自己用的区间。
 *
 * 为什么要有它：浏览器的 WebSocket 对象拿不到失败握手的响应体，但拿得到 `CloseEvent`
 * 上的 `code` 和 `reason`，所以「为什么进不去」只能从这里传出去（旧转发器同理）。
 * 后三位照抄语义相近的 HTTP 状态码，只是助记，和 HTTP 没有任何关系。
 *
 * `SUPERSEDED` 和别的不一样：它不是拒绝，是同一个玩家的新连接顶掉了旧的，
 * 旧连接本来就该消失，客户端收到它不要重连。
 */
export const CLOSE_UNAUTHORIZED = 4401
export const CLOSE_PROTOCOL_VERSION = 4426
export const CLOSE_ROOM_NOT_FOUND = 4404
export const CLOSE_ROOM_FULL = 4409
export const CLOSE_SUPERSEDED = 4004

/** 客户端版本号字符串的长度上限（`0.3.1+abc1234` 这种）。 */
const CLIENT_VERSION_MAX_LENGTH = 32

/** 账号 id 的长度上限。better-auth 发的是 uuid 一类的短串。 */
const USER_ID_MAX_LENGTH = 64

/**
 * 客户端连上后的第一条消息。
 *
 * `protocolVersion` 就是客户端编译进去的 `PROTOCOL_VERSION`；
 * `clientVersion` 只用来记日志和排查线上问题，服务端不拿它做任何判断。
 */
export const helloSchema = z.strictObject({
  type: z.literal('session:hello'),
  protocolVersion: z.number().int().min(0),
  clientVersion: z.string().min(1).max(CLIENT_VERSION_MAX_LENGTH),
})

/**
 * 这条连接连到哪儿了。
 *
 * 大厅和房间是两个 Durable Object、两条连接（《正式版架构》5.2、5.4），
 * 所以 `welcome` 得说清楚这条是哪一条：连大厅的只有身份，连房间的还带座位号。
 * **座位号只有服务端说了算**，客户端不参与分配——旧版那套 host/guest 由 URL 参数自选的做法废弃。
 */
export const welcomePlaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lobby') }),
  z.object({ kind: z.literal('room'), code: roomCodeSchema, seat: playerIdSchema }),
])

/** 这条连接连到哪儿了。 */
export type WelcomePlace = z.infer<typeof welcomePlaceSchema>

/**
 * 服务端对 `session:hello` 的回执：身份认了、版本对上了。
 *
 * 收到它之前客户端什么都别发——JWT 无效或版本不对时收到的是 `session:rejected`。
 */
export const welcomeSchema = z.object({
  type: z.literal('session:welcome'),
  /** 服务端这一侧的 `PROTOCOL_VERSION`，方便客户端把两个数一起写进日志。 */
  protocolVersion: z.number().int().min(0),
  /** JWT 里的账号 id，服务端解出来回给客户端确认。 */
  userId: z.string().min(1).max(USER_ID_MAX_LENGTH),
  place: welcomePlaceSchema,
})

/**
 * 为什么不让你进。
 *
 * `'superseded'` 是唯一一个不该重连的：同一个账号在别处开了新连接，这条本来就该退场。
 */
export const sessionRejectedReasonSchema = z.enum([
  'protocol-version',
  'unauthorized',
  'room-not-found',
  'room-full',
  'superseded',
])

/** 为什么不让你进。 */
export type SessionRejectedReason = z.infer<typeof sessionRejectedReasonSchema>

/**
 * 拒绝进入。发完这条服务端就关连接，`notice` 是可以直接显示给玩家的中文。
 *
 * 为什么先发消息再关而不是只用关闭码：关闭码只有一个数字，
 * 「版本太旧」和「房间满了」这类话得有地方写。关闭码是兜底——
 * 万一这条消息还没送到连接就断了，客户端还能从 `CloseEvent` 上认出大类。
 */
export const sessionRejectedSchema = z.object({
  type: z.literal('session:rejected'),
  reason: sessionRejectedReasonSchema,
  notice: noticeSchema,
})

/** 版本对不对得上。服务端收到 `session:hello` 之后拿它判一下就行。 */
export function isProtocolVersionSupported(clientVersion: number): boolean {
  return clientVersion === PROTOCOL_VERSION
}
