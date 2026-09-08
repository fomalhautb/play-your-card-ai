/**
 * 网络能力的网页实现。
 *
 * 重连不自己写：partysocket 是 Cloudflare 维护的重连 WebSocket，API 和原生 WebSocket 一样，
 * 断线重连、退避、连接超时、断线期间的发送队列都在里面。旧客户端用的就是它，
 * 一年多的真实弱网表现是已知的，没有理由换。
 *
 * 这个文件只做两件事：把 partysocket 的事件转成七项能力里那套「订阅返回退订函数」的形状，
 * 以及把退避参数调到适合这个游戏的数（默认值对局游戏太慢，理由见下面每个常量）。
 */

import { WebSocket as ReconnectingWebSocket } from 'partysocket'
import type {
  HttpRequestOptions,
  NetworkCapability,
  SocketHandle,
  SocketOptions,
  SocketState,
} from '../network'

/**
 * partysocket 默认的首次退避是 1~5 秒随机，对「刚断马上就好」的抖动来说太慢。
 * 注意它连第一次连接也要等这么久，所以这个值同时是「进游戏后多久开始连」。
 */
const DEFAULT_MIN_RECONNECT_DELAY_MS = 500
/** 封顶 5 秒（partysocket 默认 10 秒）。断线宽限期通常一分钟，退避太长会吃掉重试机会。 */
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5_000
const DEFAULT_RECONNECT_GROW_FACTOR = 1.5
/** partysocket 默认 4 秒，弱网下正常握手都会被判超时然后空转重连。 */
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000

export interface WebNetworkOptions {
  /**
   * 建原生 WebSocket 用的构造函数，默认是全局的 WebSocket。
   *
   * 留这个口子是为了测试：塞一个假 socket 进来就能把重连状态机整个跑一遍，
   * 不用真起一个服务器。生产代码不要传。
   */
  webSocket?: unknown
}

export function createWebNetwork(options: WebNetworkOptions = {}): NetworkCapability {
  return {
    openSocket: (socketOptions) => openWebSocket(socketOptions, options.webSocket),
    requestJson,
    onForeground,
  }
}

function openWebSocket(options: SocketOptions, webSocket: unknown): SocketHandle {
  const socket = new ReconnectingWebSocket(options.url, [], {
    minReconnectionDelay: options.minReconnectDelayMs ?? DEFAULT_MIN_RECONNECT_DELAY_MS,
    maxReconnectionDelay: options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
    reconnectionDelayGrowFactor: options.reconnectDelayGrowFactor ?? DEFAULT_RECONNECT_GROW_FACTOR,
    connectionTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    maxRetries: Number.POSITIVE_INFINITY,
    // 断线期间上层还在发消息，全部缓冲下来，连上立刻补发。
    // 不缓冲的话 send 会静默丢弃，出牌指令就那么消失了。
    maxEnqueuedMessages: Number.POSITIVE_INFINITY,
    shouldReconnectOnClose: (event) =>
      options.shouldReconnect?.({ code: event.code, reason: event.reason }) ?? true,
    // 不传就用全局 WebSocket；传了 undefined 会被 partysocket 当成「没有实现」而报错。
    ...(webSocket === undefined ? {} : { WebSocket: webSocket }),
  })

  /*
   * 状态自己记，不去读 partysocket 的 readyState。
   *
   * 它的 readyState 转发的是底层那条 socket 的：退避等待的那几秒里底层 socket 已经是 CLOSED，
   * 而这一层的语义是「还打算连上去」，两者对不上。partysocket 的 shouldReconnect
   * 正好说明「还会不会再试」，close 事件里读它就能分出 connecting 和 closed。
   */
  let state: SocketState = 'connecting'
  socket.addEventListener('open', () => {
    state = 'open'
  })
  // 这条在任何调用方的监听器之前注册，所以 onClose 的回调里读到的已经是新状态。
  socket.addEventListener('close', () => {
    state = socket.shouldReconnect ? 'connecting' : 'closed'
  })

  return {
    get state(): SocketState {
      return state
    },
    send(frame) {
      socket.send(frame)
    },
    reconnect() {
      socket.reconnect()
      // 主动重连也能把一条已经关掉的连接救回来（partysocket 允许），
      // 那种情况下没有 close 事件，状态得在这儿补上。
      state = 'connecting'
    },
    close() {
      socket.close()
      state = 'closed'
    },
    onOpen(listener) {
      const handler = (): void => listener()
      socket.addEventListener('open', handler)
      return () => socket.removeEventListener('open', handler)
    },
    onMessage(listener) {
      const handler = (event: { data: unknown }): void => {
        // 只转发文本帧。这个游戏的协议全是 JSON 字符串，
        // 二进制帧只可能是别的东西混进来了，交给上层反而会炸在解析处。
        if (typeof event.data === 'string') listener(event.data)
      }
      socket.addEventListener('message', handler)
      return () => socket.removeEventListener('message', handler)
    },
    onClose(listener) {
      const handler = (event: { code: number; reason: string }): void =>
        listener({ code: event.code, reason: event.reason })
      socket.addEventListener('close', handler)
      return () => socket.removeEventListener('close', handler)
    },
    onError(listener) {
      const handler = (): void => listener()
      socket.addEventListener('error', handler)
      return () => socket.removeEventListener('error', handler)
    },
  }
}

async function requestJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
  })
  // 非 2xx 也当失败：调用方只想要「拿到了这份 JSON」或者「没拿到」，
  // 不想在成功分支里再判一次状态码。
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

function onForeground(listener: () => void): () => void {
  const handler = (): void => {
    if (document.visibilityState === 'visible') listener()
  }
  document.addEventListener('visibilitychange', handler)
  return () => {
    document.removeEventListener('visibilitychange', handler)
  }
}
