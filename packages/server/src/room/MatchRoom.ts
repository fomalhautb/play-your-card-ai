/**
 * 房间 Durable Object：一个房间 = 一个实例，房间码就是它的名字。
 *
 * 《正式版架构》5.2 那条「房间对象跑规则」的落点。这里只做三件事——
 * **连接生命周期**（握手、认身份、分座位、顶掉旧连接、掉线通知）、**消息分发**，
 * 以及 **alarm 到点时叫谁**；规则、下发、存盘各自在 commands.ts、dispatch.ts、state.ts 里。
 *
 * 这是权威服务端：`execute` 在这儿跑，客户端只收裁剪过的事件（需求第 6 条）。
 * （黑客松那版是纯转发器，规则跑在房主客户端里，服务端没有权威状态；那套已经删掉了。）
 *
 * ## 为什么不用 partyserver
 *
 * Cloudflare 官方的 `partyserver` 确实省掉一堆 hibernation 样板，但它的 `fetch` 把 101
 * 响应写死成 `new Response(null, { status: 101, webSocket })`，**不回显子协议**。
 * 而本项目的 JWT 就走 `Sec-WebSocket-Protocol`（协议 README「认证」那一节），
 * 不回显 `ai-duel` 浏览器会直接判握手失败；它另外还要求 `/parties/:server/:name` 的路径形状、
 * 用 `_pk` 查询参数当连接 id，也和「身份只从 JWT 来」对不上。
 * 要用就得把它的 `fetch` 整个盖掉，省下来的部分正好是被盖掉的那部分，所以直接用裸 DO API。
 *
 * ## Hibernation
 *
 * 用 `ctx.acceptWebSocket()` 而不是 `server.accept()`：只有这样连接才归运行时托管，
 * 没有消息进出时对象可以休眠——连接不断、也不计时长费用。
 * 代价是内存里的东西醒来就没了，所以这个类**不留任何内存状态**：
 * 连接身份挂在附件上（net/session.ts），房间和对局在 SQLite 里（state.ts），
 * 定时器用 alarm 而不是 `setTimeout`（alarms.ts）。
 */

import { DurableObject } from 'cloudflare:workers'
import {
  authTokenFrom,
  CLOSE_ROOM_FULL,
  CLOSE_ROOM_NOT_FOUND,
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
  supersede,
  upgradeResponse,
  writeSession,
} from '../net/session'
import { takeDueAlarms } from './alarms'
import { answerCommand } from './autopilot'
import { handlePlayerCommand, runCommand } from './commands'
import { checkIdle } from './lifecycle'
import {
  broadcastPeer,
  handleLeave,
  handleLoadout,
  handleReady,
  handleResync,
  handleUrge,
  type JoinOutcome,
  joinRoom,
  reserveRoom,
  setupRoom,
} from './membership'
import { type RoomSession, seatTag, sendMalformed } from './session'
import { type RoomContext, RoomStore, roomCodeOf, seatOf } from './state'

/** 大厅排队配对成功之后调 `setup` 用的参数。 */
interface MatchRoomSetup {
  /** 两个座位分别是哪个账号，下标就是座位号。 */
  players: [string, string]
}

export class MatchRoom extends DurableObject<Env> {
  private readonly store: RoomStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new RoomStore(ctx.storage.sql)
    // 心跳交给运行时自动应答：休眠中收到 "ping" 由运行时直接回 "pong"，不唤醒对象也不计费。
    // 自动应答只认逐字节相等的字符串，所以协议里这一对故意不是 JSON（见 protocol 的 handshake.ts）。
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG))
  }

  /** RPC：排队配对成功，两个座位一次定死。调用方是大厅（src/lobby/handlers.ts）。 */
  async setup(setup: MatchRoomSetup): Promise<void> {
    await setupRoom(this.ctx, this.store, setup.players)
  }

  /**
   * RPC：私人开房，开房的人先占 0 号座。
   *
   * `code` 是大厅刚摇出来的那个码，和这个对象自己的名字必须一致——
   * 大厅要把它写进自己的房间表，两边对不上就是分配和路由走岔了，
   * 那种情况下玩家会拿到一个永远进不去的码，当场抛错比事后查容易得多。
   */
  async reserve(code: RoomCode, userId: string): Promise<void> {
    if (code !== this.code) throw new Error(`大厅给的房间码 ${code} 不是这个房间`)
    await reserveRoom(this.ctx, this.store, userId)
  }

  /** RPC：朋友按码进来占 1 号座。返回值直接就是大厅要回给玩家的那个 reason。 */
  join(userId: string): JoinOutcome {
    return joinRoom(this.store, userId)
  }

  /**
   * alarm 到点：房间那两件定时的事各自检查条件，该干什么干什么。
   *
   * 一个 Durable Object 只有一个 alarm，两件事怎么共用见 alarms.ts。
   * 每一件都**重新读一遍局面**再决定做不做：房间可能已经收摊了、对局可能已经走开了，
   * 这两种情况下什么都不发才是对的。
   */
  override async alarm(): Promise<void> {
    const due = await takeDueAlarms(this.ctx, this.store, Date.now())
    for (const kind of due) {
      const room = this.roomContext()
      if (room === null) return
      if (kind === 'quiz') {
        const command = answerCommand(this.store.game())
        if (command !== null) await runCommand(room, command, null)
      } else {
        await checkIdle(room)
      }
    }
  }

  /**
   * WebSocket 升级。
   *
   * 四道门，全都是「先回 101 再带关闭码关掉」（理由见 net/session.ts 的 `rejectUpgrade`）：
   * 没带 token / 验不过 → `unauthorized`；房间还没建或已经收了 → `room-not-found`；
   * 这个账号不是房里那两个人 → `room-full`。
   * 版本对不上不在这儿——那要等第一条消息，好把中文原因说出口（见 protocol 的 version.ts）。
   */
  override async fetch(request: Request): Promise<Response> {
    const token = authTokenFrom(request.headers.get('Sec-WebSocket-Protocol'))
    const identity = token === null ? null : await verifyToken(token, this.env)
    if (identity === null) {
      return rejectUpgrade(request, 'unauthorized', '登录状态无效，请重新登录', CLOSE_UNAUTHORIZED)
    }

    const record = this.store.room()
    if (record === null || record.closed !== null) {
      return rejectUpgrade(request, 'room-not-found', '房间不存在或已结束', CLOSE_ROOM_NOT_FOUND)
    }

    // 私人房还空着 1 号座时，不请自来的人也走这条：他得先经大厅的 `lobby:join` 占上座位，
    // 直接连房间一律当「这不是你的房间」处理。
    const seat = seatOf(record, identity.userId)
    if (seat === null) {
      return rejectUpgrade(request, 'room-full', '房间已满', CLOSE_ROOM_FULL)
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server, [seatTag(seat)])
    writeSession(server, { userId: identity.userId, seat, greeted: false })
    supersede(this.ctx, seatTag(seat), server, '你在别处打开了房间')

    return upgradeResponse(request, client)
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 协议里没有二进制消息，也没有别的裸字符串。心跳这两个正常由运行时自动应答挡掉，
    // 这里再挡一次是因为自动应答在某些路径上不生效（比如对象刚好醒着）。
    if (typeof message !== 'string') return
    if (message === HEARTBEAT_PING || message === HEARTBEAT_PONG) return

    const session = readSession<RoomSession>(ws)
    if (session === null) return

    const parsed = parseClientMessage(message)
    if (!parsed.ok) {
      // `DEBUG_*` 和 `SUBMIT_ANSWERS` 就是在这一步被挡掉的：`matchCommandSchema` 的载荷
      // 只认 `playerCommandSchema` 那四种玩家操作，它们连指令都没变成就整条过不了 schema。
      //
      // 回不回这条错要看环境（见 session.ts 的 `sendMalformed`）：线上一律静默丢弃。
      sendMalformed(this.env, ws, '这条消息没看懂')
      return
    }
    if (parsed.value.type === 'session:hello') {
      this.hello(ws, session, parsed.value.protocolVersion)
      return
    }
    if (!session.greeted) {
      sendMalformed(this.env, ws, '先发 session:hello')
      return
    }
    await this.route(ws, session, parsed.value)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.notifyOffline(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // 异常断开不走 webSocketClose，对手同样需要知道。
    this.notifyOffline(ws)
  }

  /** 房间码就是这个对象的名字，不另存一份（见 state.ts 的 `roomCodeOf`）。 */
  private get code(): RoomCode {
    return roomCodeOf(this.ctx)
  }

  /** 每条消息都现从 SQLite 读一份（为什么不缓存见 state.ts）。房间没建或已收摊时返回 null。 */
  private roomContext(): RoomContext | null {
    const record = this.store.room()
    if (record === null || record.closed !== null) return null
    return { ctx: this.ctx, env: this.env, store: this.store, record }
  }

  /** `session:hello`：版本对得上才算进门，之后才广播对手状态。 */
  private hello(ws: WebSocket, session: RoomSession, clientVersion: number): void {
    const place = { kind: 'room', code: this.code, seat: session.seat } as const
    if (!greet(ws, session, clientVersion, place)) return
    // 打完招呼才广播：在此之前这条连接还没确认协议版本，不该收任何业务消息。
    // 快照不主动推——客户端拿到 welcome 之后自己发 `room:resync` 要（协议 README 第 4 条）。
    const room = this.roomContext()
    if (room !== null) broadcastPeer(room)
  }

  /** 打完招呼之后的消息各归各家。大厅的那几种消息发到房间来一律当没看懂。 */
  private async route(ws: WebSocket, session: RoomSession, message: ClientMessage): Promise<void> {
    const room = this.roomContext()
    if (room === null) return
    const seat = session.seat
    switch (message.type) {
      case 'room:loadout':
        handleLoadout(room, ws, seat, message)
        break
      case 'room:ready':
        handleReady(room, ws, seat)
        break
      case 'room:leave':
        await handleLeave(room)
        break
      case 'room:resync':
        handleResync(room, ws, seat, message.haveSeq)
        break
      case 'room:urge':
        handleUrge(room, ws, seat, message.id)
        break
      case 'match:command':
        await handlePlayerCommand(room, ws, seat, message.command)
        break
      default:
        sendMalformed(this.env, ws, '这条消息不是发给房间的')
    }
  }

  /**
   * 一条连接没了，告诉对手。
   *
   * 先确认这个**座位**是真的空了：重连时新连接会顶掉旧的，旧连接的关闭回调随后才到，
   * 这时候同一个座位已经有新连接在房里了。不查这一下每次重连都会给对手误报一次掉线。
   */
  private notifyOffline(ws: WebSocket): void {
    const session = readSession<RoomSession>(ws)
    if (session === null) return
    const others = this.ctx.getWebSockets(seatTag(session.seat)).filter((other) => other !== ws)
    if (others.length > 0) return
    const room = this.roomContext()
    if (room !== null) broadcastPeer(room, ws)
  }
}
