/**
 * 房间 Durable Object：一个房间 = 一个实例，房间码就是它的名字。
 *
 * 《正式版架构》5.2 那条「房间对象跑规则」的落点。这里只做两件事——
 * **连接生命周期**（握手、认身份、分座位、顶掉旧连接、掉线通知）和**消息分发**，
 * 规则、下发、存盘各自在 commands.ts、dispatch.ts、state.ts 里。
 *
 * 和同目录之外那个 legacy/room.ts 的根本区别：那个是纯转发器，服务端没有权威状态；
 * 这个是权威服务端，`execute` 在这儿跑，客户端只发指令、只收裁剪过的事件（需求第 6 条）。
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
 * 连接身份挂在附件上（session.ts），房间和对局在 SQLite 里（state.ts）。
 */

import { DurableObject } from 'cloudflare:workers'
import { scriptedAnswers } from '@ai-duel/content'
import {
  authTokenFrom,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_ROOM_FULL,
  CLOSE_ROOM_NOT_FOUND,
  CLOSE_SUPERSEDED,
  CLOSE_UNAUTHORIZED,
  type ClientMessage,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  isProtocolVersionSupported,
  PROTOCOL_VERSION,
  parseClientMessage,
  type RoomCode,
  roomCodeSchema,
} from '@ai-duel/protocol'
import { verifyToken } from '../auth/verify'
import { handlePlayerCommand, type RoomContext, runCommand } from './commands'
import {
  broadcastPeer,
  handleLeave,
  handleLoadout,
  handleReady,
  handleResync,
  handleUrge,
} from './membership'
import {
  readSession,
  rejectUpgrade,
  type SessionAttachment,
  seatTag,
  send,
  sendRoomError,
  upgradeResponse,
  writeSession,
} from './session'
import { RoomStore, seatOf } from './state'

/** 大厅配对成功之后调 `setup` 用的参数。第 24 条把大厅接上之前，只有测试会调它。 */
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

  /**
   * RPC：建房，把两个座位的账号定下来。
   *
   * 谁来调是第 24 条大厅对象的事，本 PR 只有测试调。
   * 重复调直接忽略而不是重建：房间码有可能撞上一个还在打的房间，
   * 重建会把正在进行的对局抹掉。
   */
  setup(setup: MatchRoomSetup): void {
    if (this.store.room() !== null) return
    this.store.saveRoom({
      players: setup.players,
      loadout: [null, null],
      ready: [false, false],
      seq: [0, 0],
      closed: null,
    })
  }

  /**
   * RPC：替场上的 AI 答完这一轮的题。
   *
   * `SUBMIT_ANSWERS` 是**只有服务端能发**的指令（协议 README「指令：谁能发什么」）——
   * 它直接决定谁答对、谁得分，客户端能发就等于能宣布自己全对，
   * 所以它连解析层都过不去（`matchCommandSchema` 只认 `playerCommandSchema` 那四种）。
   *
   * 这里暂时做成 RPC 由测试手动触发；迁移第 23 条改成 DO 的 alarm 到点自己调，
   * 那时这个方法变成 alarm 回调的内部实现，触发方式变而内容不变。
   */
  submitAnswers(): void {
    const room = this.roomContext()
    const state = this.store.game()
    if (room === null || state === null) return
    const question = state.questions[state.round - 1]
    if (question === undefined) return
    const units = [...state.players[0].board, ...state.players[1].board]
    runCommand(room, { type: 'SUBMIT_ANSWERS', results: scriptedAnswers(question, units) }, null)
  }

  /**
   * WebSocket 升级。
   *
   * 四道门，全都是「先回 101 再带关闭码关掉」（理由见 session.ts 的 `rejectUpgrade`）：
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

    const seat = seatOf(record, identity.userId)
    if (seat === null) {
      return rejectUpgrade(request, 'room-full', '房间已满', CLOSE_ROOM_FULL)
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server, [seatTag(seat)])
    writeSession(server, { userId: identity.userId, seat, greeted: false })

    // 顶掉自己这个座位上的旧连接。顺序要紧：先 accept 新的再关旧的，
    // 这样旧连接的 close 回调查「这个座位还有别的连接吗」时能查到新的那条，
    // 就不会把一次重连误报成掉线（旧转发器踩过这个坑，见 legacy/room.ts）。
    for (const stale of this.ctx.getWebSockets(seatTag(seat))) {
      if (stale === server) continue
      send(stale, { type: 'session:rejected', reason: 'superseded', notice: '你在别处打开了房间' })
      stale.close(CLOSE_SUPERSEDED, 'superseded')
    }

    return upgradeResponse(request, client)
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 协议里没有二进制消息，也没有别的裸字符串。心跳这两个正常由运行时自动应答挡掉，
    // 这里再挡一次是因为自动应答在某些路径上不生效（比如对象刚好醒着）。
    if (typeof message !== 'string') return
    if (message === HEARTBEAT_PING || message === HEARTBEAT_PONG) return

    const session = readSession(ws)
    if (session === null) return

    const parsed = parseClientMessage(message)
    if (!parsed.ok) {
      // `DEBUG_*` 和 `SUBMIT_ANSWERS` 就是在这一步被挡掉的：`matchCommandSchema` 的载荷
      // 只认 `playerCommandSchema` 那四种，它们连指令都没变成就整条过不了 schema。
      //
      // 协议 README 说 `malformed` 只该在开发模式下发（线上告诉对方「你发的东西我没看懂」
      // 除了帮他调试没别的用处）。这里一律发，是因为客户端的 driver 眼下还没写完，
      // 静默丢弃会让「消息发错了」和「服务端没反应」长得一模一样。
      // 等第 27 条 serverDriver 接上、上线之前，这条要改成按环境开关。
      sendRoomError(ws, 'malformed', '这条消息没看懂')
      return
    }
    if (parsed.value.type === 'session:hello') {
      this.hello(ws, session, parsed.value.protocolVersion)
      return
    }
    if (!session.greeted) {
      sendRoomError(ws, 'malformed', '先发 session:hello')
      return
    }
    this.route(ws, session, parsed.value)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.notifyOffline(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // 异常断开不走 webSocketClose，对手同样需要知道。
    this.notifyOffline(ws)
  }

  /**
   * 房间码就是这个 Durable Object 的名字（路由用 `getByName(code)` 找它），所以不用另存一份。
   *
   * 名字不是四位数字说明有人绕开路由直接按 id 造了个房间，属于代码错误而不是玩家能触发的事，
   * 当场抛错好过发一条客户端解析不了的 `session:welcome`。
   */
  private get code(): RoomCode {
    const name = this.ctx.id.name
    const parsed = roomCodeSchema.safeParse(name)
    if (!parsed.success) throw new Error(`房间对象的名字不是房间码：${name}`)
    return parsed.data
  }

  /** 每条消息都现从 SQLite 读一份（为什么不缓存见 state.ts）。房间没建或已收摊时返回 null。 */
  private roomContext(): RoomContext | null {
    const record = this.store.room()
    if (record === null || record.closed !== null) return null
    return { ctx: this.ctx, store: this.store, record }
  }

  /**
   * `session:hello`：版本对得上才算进门。
   *
   * 版本比对放在第一条消息而不是子协议名里，就是为了这一刻能把「请刷新页面」说出口
   * （见 protocol 的 version.ts）。
   */
  private hello(ws: WebSocket, session: SessionAttachment, clientVersion: number): void {
    if (!isProtocolVersionSupported(clientVersion)) {
      send(ws, {
        type: 'session:rejected',
        reason: 'protocol-version',
        notice: '客户端版本太旧了，请刷新页面',
      })
      ws.close(CLOSE_PROTOCOL_VERSION, 'protocol-version')
      return
    }
    writeSession(ws, { ...session, greeted: true })
    send(ws, {
      type: 'session:welcome',
      protocolVersion: PROTOCOL_VERSION,
      userId: session.userId,
      place: { kind: 'room', code: this.code, seat: session.seat },
    })
    // 打完招呼才广播：在此之前这条连接还没确认协议版本，不该收任何业务消息。
    // 快照不主动推——客户端拿到 welcome 之后自己发 `room:resync` 要（协议 README 第 4 条）。
    const room = this.roomContext()
    if (room !== null) broadcastPeer(room)
  }

  /** 打完招呼之后的消息各归各家。大厅的那几种消息发到房间来一律当没看懂。 */
  private route(ws: WebSocket, session: SessionAttachment, message: ClientMessage): void {
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
        handleLeave(room)
        break
      case 'room:resync':
        handleResync(room, ws, seat, message.haveSeq)
        break
      case 'room:urge':
        handleUrge(room, seat, message.id)
        break
      case 'match:command':
        handlePlayerCommand(room, ws, seat, message.command)
        break
      default:
        sendRoomError(ws, 'malformed', '这条消息不是发给房间的')
    }
  }

  /**
   * 一条连接没了，告诉对手。
   *
   * 先确认这个**座位**是真的空了：重连时新连接会顶掉旧的，旧连接的关闭回调随后才到，
   * 这时候同一个座位已经有新连接在房里了。不查这一下每次重连都会给对手误报一次掉线。
   */
  private notifyOffline(ws: WebSocket): void {
    const session = readSession(ws)
    if (session === null) return
    const others = this.ctx.getWebSockets(seatTag(session.seat)).filter((other) => other !== ws)
    if (others.length > 0) return
    const room = this.roomContext()
    if (room !== null) broadcastPeer(room, ws)
  }
}
