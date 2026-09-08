/**
 * 网络能力：一条会自动重连的 WebSocket，加上取 JSON 的 HTTP 请求。
 *
 * 这一层只到「帧」为止——看到的是字符串，不认识房间、回合、消息类型。
 * 心跳内容、可靠送达的信封、断线宽限期都不在这儿：那些要看懂协议，属于 client 那一层
 *（旧代码把两件事挤在 legacy-client/src/net/socket.ts 一个文件里，重写时按这条缝切开）。
 *
 * 留给上层的抓手是 `reconnect()` 和 `onForeground()`：弱网下最难受的不是断线，
 * 而是「半开」——socket 还显示连着，数据其实出不去，靠 TCP 自己发现要几分钟。
 * 识破它要两样东西：一个由协议层发的心跳，和一个「刚切回前台，赶紧探一探」的时机。
 */

/**
 * 连接的三个状态。
 *
 * 断线之后只要还打算重试就一直是 connecting（包括退避等待的那几秒），
 * closed 只表示「不会再连了」：主动关掉，或者关闭码被判定为不该重试。
 * 想知道「现在消息送不送得到」不要看这个，要看 onOpen / onClose——
 * 端到端通不通还取决于对手在不在，那是协议层才知道的事。
 */
export type SocketState = 'connecting' | 'open' | 'closed'

export interface SocketCloseInfo {
  /**
   * WebSocket 关闭码。
   * 4000~4999 是应用自己定义的区间，服务端用它区分「房间不存在」这类业务拒绝，
   * 上层照它决定还要不要重连——业务拒绝再试多少次都是同样的结果。
   */
  code: number
  reason: string
}

export interface SocketOptions {
  /**
   * 每次（重）连之前调一次，返回这一次要连的地址。
   *
   * 写成函数不是为了灵活：旧代码第一次进房和重连回去要带不同的查询参数（resume=1），
   * 地址必须在每次连接的那一刻现算，不能建连接时定死。
   */
  url(): string
  /** 断线后第一次重试等多久。默认 500 毫秒。 */
  minReconnectDelayMs?: number
  /** 退避的上限。默认 5 秒——宽限期通常只有一分钟，退避太长会白白吃掉重试机会。 */
  maxReconnectDelayMs?: number
  /** 每失败一次，等待时间乘上这个倍数。默认 1.5。 */
  reconnectDelayGrowFactor?: number
  /** 一次握手等多久算超时。默认 8 秒。 */
  connectTimeoutMs?: number
  /** 关闭之后要不要重连。默认一律重连（当成网络问题）。 */
  shouldReconnect?(info: SocketCloseInfo): boolean
}

export interface SocketHandle {
  readonly state: SocketState
  /**
   * 发一帧。连接没通时不抛错也不丢：帧会排队，连上之后按顺序补发。
   *
   * 裸 WebSocket 在 CLOSING / CLOSED 状态下 `send()` 是静默丢弃的，
   * 出牌指令就那么消失，界面停在「等待对方出牌」——这一层存在的头号理由。
   */
  send(frame: string): void
  /**
   * 立刻断开并重新连一次，不等退避。
   * 上层发现心跳超时（半开连接）时调它，不然要等 TCP 自己发现。
   */
  reconnect(): void
  /** 关掉连接并停掉自动重连。 */
  close(): void
  /** 下面四个都返回退订函数。 */
  onOpen(listener: () => void): () => void
  onMessage(listener: (frame: string) => void): () => void
  onClose(listener: (info: SocketCloseInfo) => void): () => void
  /**
   * 连接出错。不带任何细节——浏览器出于安全考虑不暴露原因，
   * 所以这个回调只用来更新「链路断了」的界面状态，报错交给 onClose。
   */
  onError(listener: () => void): () => void
}

export interface HttpRequestOptions {
  method?: string
  headers?: Readonly<Record<string, string>>
  /** 请求体，已经序列化好的字符串。 */
  body?: string
  /** 取消这次请求。AbortSignal 三个壳里都有，不是浏览器独有的类型。 */
  signal?: AbortSignal
}

export interface NetworkCapability {
  openSocket(options: SocketOptions): SocketHandle
  /**
   * 取一份 JSON。非 2xx 也抛错，调用方只在一处 catch。
   *
   * 只有这一个 HTTP 方法：旧代码全站只有一处 fetch（摇房间码的 `GET /api/room`），
   * 别的都走 WebSocket。真需要别的请求形态时再加，不预先铺一套通用 HTTP 客户端。
   */
  requestJson<T>(url: string, options?: HttpRequestOptions): Promise<T>
  /**
   * 应用回到前台。返回退订函数。
   *
   * 为什么网络能力要管这件事：手机锁屏或切后台期间定时器会被节流甚至冻住，
   * 连接多半已经死了但事件还没送达。不主动探的话，玩家切回来是对着一条死连接干等。
   * 探活帧发什么由协议层决定，平台层只报告「现在该探一探了」这个时机。
   */
  onForeground(listener: () => void): () => void
}
