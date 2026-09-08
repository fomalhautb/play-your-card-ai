/**
 * 大厅 Durable Object：**全局只有一个实例**（`getByName(LOBBY_NAME)`）。
 *
 * 《正式版架构》5.4：一条全局匹配队列，配对成功就摇一个房间码、把房间建出来、
 * 把码发给双方；私人开房和按码加入也从这儿走。玩家拿到 `lobby:room` 之后
 * 自己断开大厅、另开一条连接去连房间对象（协议 README「两条连接」）。
 *
 * 为什么是单实例：队列要凑一对人，切成多个实例就等于把队列切碎，人一少就永远配不上。
 * 代价是所有匹配请求都排到同一个对象上串行处理——但一次匹配只是几条 SQLite 读写
 * 加一次建房 RPC，这点吞吐远够用，真到瓶颈那天再按地区分区。
 *
 * 握手、心跳、附件、顶号和房间对象**完全同一套**，代码在 net/session.ts；
 * 这里和 MatchRoom 的差别只有两处：`session:welcome` 里的 `place` 是 `{kind:'lobby'}`，
 * 以及连接按账号而不是按座位打标签（大厅没有座位）。
 */

import { DurableObject } from 'cloudflare:workers'
import {
  authTokenFrom,
  CLOSE_UNAUTHORIZED,
  type ClientMessage,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  parseClientMessage,
  type RoomCode,
} from '@ai-duel/protocol'
import { verifyToken } from '../auth/verify'
import {
  greet,
  readSession,
  rejectUpgrade,
  type Session,
  supersede,
  upgradeResponse,
  writeSession,
} from '../net/session'
import {
  handleCancel,
  handleCreate,
  handleDisconnect,
  handleJoin,
  handleQueue,
  type LobbyContext,
  sendMissingCode,
} from './handlers'
import { userTag } from './naming'
import { LobbyStore } from './queue'

export class Lobby extends DurableObject<Env> {
  private readonly store: LobbyStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new LobbyStore(ctx.storage.sql)
    // 心跳交给运行时自动应答，理由同 MatchRoom：休眠中不唤醒对象也不计费。
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG))
  }

  /**
   * RPC：房间收摊了，把它的码收回来（调用方是 room/lifecycle.ts）。
   *
   * 由房间通知而不是大厅自己按时间过期，是因为「这个码还有没有人用」只有房间知道：
   * 一局可能三分钟打完，也可能因为断线重连拖很久，大厅在外面猜不准。
   * 码表里那个岁数上限只是兜底，防这条 RPC 丢了之后码永远占着（见 queue.ts）。
   */
  release(code: RoomCode): void {
    this.store.releaseRoom(code)
  }

  /**
   * WebSocket 升级。只有一道门：JWT 验不过就进不来。
   *
   * 大厅没有「房间不存在」「房间满了」那两道——它谁都能进，
   * 进不来的只有认不出身份的人。拒绝方式同房间：先 101 再带关闭码关掉
   * （浏览器拿不到失败握手的响应体，见 net/session.ts 的 `rejectUpgrade`）。
   */
  override async fetch(request: Request): Promise<Response> {
    const token = authTokenFrom(request.headers.get('Sec-WebSocket-Protocol'))
    const identity = token === null ? null : await verifyToken(token, this.env)
    if (identity === null) {
      return rejectUpgrade(request, 'unauthorized', '登录状态无效，请重新登录', CLOSE_UNAUTHORIZED)
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    const tag = userTag(identity.userId)
    this.ctx.acceptWebSocket(server, [tag])
    writeSession(server, { userId: identity.userId, greeted: false })
    // 顶掉这个账号留下的旧连接。先 accept 新的再顶旧的，旧连接的关闭回调才不会
    // 把一次重连当成「他走了」而把人踢出队列（见 handlers.ts 的 `handleDisconnect`）。
    supersede(this.ctx, tag, server, '你在别处打开了大厅')

    return upgradeResponse(request, client)
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    if (message === HEARTBEAT_PING || message === HEARTBEAT_PONG) return

    const session = readSession(ws)
    if (session === null) return

    const parsed = parseClientMessage(message)
    if (!parsed.ok) {
      // 大厅这一层没有「你发的东西我没看懂」这种错（协议只给了五个 reason），
      // 所以整体是静默丢弃。唯一例外是一条形状不对的 `lobby:join`——
      // 那基本上就是界面没填房间码就点了加入，玩家需要知道缺的是什么。
      if (claimsJoin(message)) sendMissingCode(ws)
      return
    }
    if (parsed.value.type === 'session:hello') {
      greet(ws, session, parsed.value.protocolVersion, { kind: 'lobby' })
      return
    }
    if (!session.greeted) return
    await this.route(ws, session, parsed.value)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.disconnect(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // 异常断开不走 webSocketClose，一样要出队。
    this.disconnect(ws)
  }

  private context(): LobbyContext {
    return { ctx: this.ctx, env: this.env, store: this.store }
  }

  /**
   * 打完招呼之后的消息各归各家。
   *
   * 房间的那几种消息发到大厅来一律丢掉：大厅根本没有房间上下文，
   * 而协议里 `room:error` 是房间发的消息，从大厅发过去客户端也对不上号。
   */
  private async route(ws: WebSocket, session: Session, message: ClientMessage): Promise<void> {
    const lobby = this.context()
    switch (message.type) {
      case 'lobby:queue':
        await handleQueue(lobby, ws, session.userId)
        break
      case 'lobby:cancel':
        handleCancel(lobby, ws, session.userId)
        break
      case 'lobby:create':
        await handleCreate(lobby, ws, session.userId)
        break
      case 'lobby:join':
        await handleJoin(lobby, ws, session.userId, message.code)
        break
      default:
        break
    }
  }

  private disconnect(ws: WebSocket): void {
    const session = readSession(ws)
    if (session === null) return
    handleDisconnect(this.context(), session.userId, ws)
  }
}

/**
 * 这条过不了 schema 的消息自称是 `lobby:join` 吗。
 *
 * 只看顶层那个 `type` 字段：整条都没过校验，别的字段一个都不能信，
 * 但「客户端想干什么」这一点还是问得出来的，够用来回一句有意义的错。
 */
function claimsJoin(message: string): boolean {
  try {
    const payload: unknown = JSON.parse(message)
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { type?: unknown }).type === 'lobby:join'
    )
  } catch {
    return false
  }
}
