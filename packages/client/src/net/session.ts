/**
 * 一条 WebSocket 的会话层：带凭据握手、对协议版本、发心跳、报告链路断了。
 *
 * 大厅和房间的这一段是**同一套**（服务端也共用一份 `src/net/session.ts`），
 * 差别只有 `session:welcome` 里的 `place`，所以这里既不认识座位也不认识队列。
 *
 * ## 这一层不写重连
 *
 * 退避、连接超时、断线期间的发送队列全在 `platform.network` 底下的 partysocket 里
 *（见 platform 的 network.ts）。这里只补两件 partysocket 看不懂、非要懂协议才做得了的事：
 *
 * 1. **每次连上都要重新打招呼。** 服务端那条连接是新的，它还不知道这个客户端的协议版本，
 *    在收到 `session:hello` 之前一条业务消息都不会理（server 的 net/session.ts）。
 * 2. **靠心跳识破半开连接。** socket 看着还开着、数据其实出不去的时候，
 *    等 TCP 自己发现要几分钟，而一局对战撑不了几分钟。
 *
 * ## 打完招呼之前的业务消息要压着
 *
 * `SocketHandle.send` 在没连上时会把帧排队，连上一次性补发——补发排在 `onOpen` **之前**，
 * 于是排队的业务消息会跑到 `session:hello` 前头去，被服务端当成「没打招呼就说话」丢掉。
 * 所以这一层自己再压一道：握手成功之前的消息攒着，`session:welcome` 到了再放出去。
 */

import type { NetworkCapability } from '@ai-duel/platform'
import type {
  ClientMessage,
  ServerMessage,
  SessionRejectedReason,
  WelcomePlace,
} from '@ai-duel/protocol'
import {
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  PROTOCOL_VERSION,
  parseServerMessage,
  subprotocolsFor,
} from '@ai-duel/protocol'

/**
 * 报给服务端的客户端版本，只进日志，服务端不拿它做任何判断（见协议的 `helloSchema`）。
 * 构建时打进真实版本号是发版那一步的事（迁移第 37 条），在那之前有个能认出来的值就够。
 */
const DEFAULT_CLIENT_VERSION = '0.0.0-dev'

/** 多久发一次心跳。要明显短于运营商 NAT 和 Cloudflare 边缘的空闲超时（后者约 100 秒）。 */
const PING_INTERVAL_MS = 15_000
/** 发出 ping 之后等 pong 的上限，超了就认定这条是半开连接，换一条。 */
const PONG_TIMEOUT_MS = 20_000
/** 心跳检查的节拍。比发送间隔短，是为了让超时判定的精度不受节拍拖累。 */
const HEARTBEAT_TICK_MS = 5_000

/** 服务端业务拒绝的关闭码区间。4000–4999 是 WebSocket 留给应用自己用的那一段。 */
const APP_CLOSE_CODE_MIN = 4000
const APP_CLOSE_CODE_MAX = 4999

export interface SessionOptions {
  network: NetworkCapability
  /** 每次（重）连之前现算一次地址。 */
  url(): string
  /**
   * 每次（重）连之前现换一张短时效 JWT。
   *
   * 它走 `Sec-WebSocket-Protocol`（见协议的 handshake.ts），默认只活十五分钟，
   * 所以挂了半小时之后重连必须现取，不能建连接时定死一张。
   */
  token(): Promise<string>
  clientVersion?: string
  /** 握手成功。**每次重连都会再来一次**，调用方据此重新要快照。 */
  onWelcome(place: WelcomePlace, userId: string): void
  /** 不让进。这条之后连接必然关掉，也不会重连。 */
  onRejected(reason: SessionRejectedReason, notice: string): void
  /** 除握手之外的每一条服务端消息。 */
  onMessage(message: ServerMessage): void
  /** 这条连接断了。底层会自己重连，连回来会再走一次 `onWelcome`。 */
  onDown(): void
}

export interface Session {
  /** 发一条消息。握手还没完成就先压着，完成后按顺序放出去。 */
  send(message: ClientMessage): void
  /** 关掉连接并停掉自动重连。之后不再有任何回调。 */
  close(): void
}

export function openSession(options: SessionOptions): Session {
  const clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION
  /** 调用方主动关过了。关过之后一律不再往上报，免得关闭动作自己触发一次「断线」。 */
  let disposed = false
  /** 这条连接握完手了没有。断线归零：新连接要重新打招呼。 */
  let greeted = false
  /** 握手完成前压着的业务消息。 */
  let pending: ClientMessage[] = []
  /** 最近一次收到 pong 的时刻；发出 ping 还没等到 pong 时 `pingSentAt` 非空。 */
  let lastPongAt = Date.now()
  let pingSentAt: number | null = null

  const handle = options.network.openSocket({
    url: options.url,
    protocols: async () => subprotocolsFor(await options.token()),
    /*
     * 4000–4999 是服务端的业务拒绝（协议的 `CLOSE_*`）：凭据无效、房间不存在、
     * 房间满了、被同一个账号的新连接顶掉。这些再试多少次都是同样的结果，
     * 重连只会变成一台自己刷自己的机器。其余关闭码一律当网络问题交给底层重连。
     */
    shouldReconnect: (info) => info.code < APP_CLOSE_CODE_MIN || info.code > APP_CLOSE_CODE_MAX,
  })

  function frame(message: ClientMessage): void {
    handle.send(JSON.stringify(message))
  }

  handle.onOpen(() => {
    greeted = false
    lastPongAt = Date.now()
    pingSentAt = null
    frame({ type: 'session:hello', protocolVersion: PROTOCOL_VERSION, clientVersion })
  })

  handle.onMessage((raw) => {
    // 心跳是两个裸字符串，不是 JSON，喂给 parseServerMessage 只会得到一条解析失败。
    if (raw === HEARTBEAT_PONG) {
      lastPongAt = Date.now()
      pingSentAt = null
      return
    }
    if (raw === HEARTBEAT_PING) return
    const parsed = parseServerMessage(raw)
    // 解析不了就丢：下行是自家服务端发的，收到看不懂的东西说明版本或链路出了问题，
    // 而这一层没有「告诉服务端你发错了」的通道，硬当成消息传上去只会炸在更远的地方。
    if (!parsed.ok) return
    const message = parsed.value
    if (message.type === 'session:welcome') {
      greeted = true
      // 先让调用方发它的第一条（房间会发 room:resync 要快照），再补发压着的那些：
      // 断线期间攒下的指令是旧的，让「先对一次账」排在它们前面。
      options.onWelcome(message.place, message.userId)
      const queued = pending
      pending = []
      for (const item of queued) frame(item)
      return
    }
    if (message.type === 'session:rejected') {
      options.onRejected(message.reason, message.notice)
      // 服务端发完这条就关连接，协议也写明不许重连。这里主动收掉，
      // 免得关闭码万一不在 4000 区间时底层还傻乎乎地连回去。
      close()
      return
    }
    options.onMessage(message)
  })

  function down(): void {
    if (disposed) return
    greeted = false
    options.onDown()
  }
  handle.onClose(down)
  // 出错不一定跟着 close（浏览器不给细节），链路状态一样要往上报。
  handle.onError(down)

  function ping(): void {
    if (handle.state !== 'open') return
    handle.send(HEARTBEAT_PING)
    pingSentAt = Date.now()
  }

  const heartbeat = setInterval(() => {
    if (handle.state !== 'open') return
    const now = Date.now()
    if (pingSentAt === null) {
      if (now - lastPongAt >= PING_INTERVAL_MS) ping()
      return
    }
    if (now - pingSentAt <= PONG_TIMEOUT_MS) return
    // 发了 ping 等不到 pong：这条 socket 是半开的。主动换一条，不等 TCP 自己发现。
    pingSentAt = null
    handle.reconnect()
  }, HEARTBEAT_TICK_MS)

  /*
   * 切后台期间定时器会被节流甚至冻住，连接多半已经死了但事件还没送达。
   * 回到前台立刻探一帧，把「半开」的判定从「最多再等一个发送间隔」提前到马上开始计时。
   */
  const stopForeground = options.network.onForeground(() => {
    if (pingSentAt === null) ping()
  })

  function close(): void {
    if (disposed) return
    disposed = true
    clearInterval(heartbeat)
    stopForeground()
    handle.close()
  }

  return {
    send(message) {
      if (disposed) return
      if (!greeted) {
        pending.push(message)
        return
      }
      frame(message)
    },
    close,
  }
}
