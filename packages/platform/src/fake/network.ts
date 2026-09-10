/**
 * 网络能力的假实现：不开任何真连接，收发都由测试脚本说了算。
 *
 * 状态机照着 partysocket 的行为写（web 实现底下就是它），这样对着假实现写的测试
 * 和真跑起来的表现是一回事：
 * - 建出来就是 connecting，要有人「接」它才变 open；
 * - 断开时问一句 shouldReconnect，要重连就回到 connecting 并重新算一次地址
 *   （地址每次现算，因为重连要带 resume 这类参数）；
 * - 没连上的时候 send 不丢也不抛，帧排队等连上再补发。
 */

import { createSignal } from '../listeners'
import type { NetworkCapability, SocketCloseInfo, SocketHandle, SocketOptions } from '../network'

export interface FakeSocket extends SocketHandle {
  /** 已经真的发出去的帧，按顺序。还在排队等连接的不算。 */
  readonly sent: readonly string[]
  /** 每次（重）连时算出来的地址，最新的在最后。 */
  readonly urls: readonly string[]
  /**
   * 每次（重）连时取到的子协议名，下标和 `urls` 对齐。
   *
   * 取子协议是异步的（换凭据要走一次请求），所以这一项要等一个微任务才填得上；
   * 在那之前是空数组。真实现里 partysocket 会等它取完才发起连接，
   * 假实现不等——`acceptConnection()` 什么时候调由测试说了算，
   * 再模拟一道等待只会让每条测试都多一步 await。
   */
  readonly protocols: readonly (readonly string[])[]
  /** 假装连上了。 */
  acceptConnection(): void
  /** 假装收到一帧。 */
  deliver(frame: string): void
  /** 假装断了。默认按网络问题处理（会照 shouldReconnect 决定要不要重连）。 */
  dropConnection(info?: Partial<SocketCloseInfo>): void
  /** 假装出了一次错。浏览器不给细节，所以这里也没有参数。 */
  raiseError(): void
}

export interface FakeNetwork extends NetworkCapability {
  /** 开出去的连接，最新的在最后。 */
  readonly sockets: readonly FakeSocket[]
  /** 配一个地址的 JSON 答案。没配过的地址 requestJson 会 reject。 */
  respondWith(url: string, body: unknown): void
  /** 触发一次「回到前台」。 */
  enterForeground(): void
}

export function createFakeNetwork(): FakeNetwork {
  const sockets: FakeSocket[] = []
  const responses = new Map<string, unknown>()
  const foreground = createSignal()

  return {
    sockets,
    openSocket(options) {
      const socket = createFakeSocket(options)
      sockets.push(socket)
      return socket
    },
    requestJson<T>(url: string): Promise<T> {
      if (!responses.has(url)) return Promise.reject(new Error(`没有给 ${url} 配答案`))
      return Promise.resolve(responses.get(url) as T)
    },
    onForeground: (listener) => foreground.add(listener),
    respondWith(url, body) {
      responses.set(url, body)
    },
    enterForeground() {
      foreground.emit()
    },
  }
}

function createFakeSocket(options: SocketOptions): FakeSocket {
  const opened = createSignal()
  const messages = createSignal<string>()
  const closed = createSignal<SocketCloseInfo>()
  const errored = createSignal()

  const sent: string[] = []
  const urls: string[] = []
  const protocols: string[][] = []
  /** 连接没通时攒下的帧，连上就按顺序补发。 */
  const queued: string[] = []
  let state: 'connecting' | 'open' | 'closed' = 'connecting'

  /** 开始一次连接尝试：地址和子协议各现取一次。 */
  function connect(): void {
    state = 'connecting'
    // 先占好这一次的位置再去异步取子协议，这样连着重连几次也不会把两个数组的下标错开。
    const attempt = urls.length
    urls.push(options.url())
    protocols[attempt] = []
    void Promise.resolve(options.protocols?.() ?? []).then((list) => {
      protocols[attempt] = list
    })
  }
  connect()

  return {
    sent,
    urls,
    protocols,
    get state() {
      return state
    },

    send(frame) {
      if (state === 'open') sent.push(frame)
      else queued.push(frame)
    },
    reconnect() {
      if (state === 'closed') return
      // 主动重连不问 shouldReconnect：那是给「服务端把我关了」用的判据，
      // 这里是上层自己要求换一条连接（比如心跳超时判定半开）。
      if (state === 'open') closed.emit({ code: 1000, reason: '' })
      connect()
    },
    close() {
      state = 'closed'
    },

    onOpen: (listener) => opened.add(listener),
    onMessage: (listener) => messages.add(listener),
    onClose: (listener) => closed.add(listener),
    onError: (listener) => errored.add(listener),

    acceptConnection() {
      if (state !== 'connecting') return
      state = 'open'
      // 断线期间攒下的先补发，再通知上层「通了」——顺序和真实现一致：
      // 上层在 onOpen 里发的东西应该排在补发的后面。
      sent.push(...queued)
      queued.length = 0
      opened.emit()
    },
    deliver(frame) {
      if (state !== 'open') return
      messages.emit(frame)
    },
    dropConnection(info = {}) {
      if (state === 'closed') return
      const full: SocketCloseInfo = { code: info.code ?? 1006, reason: info.reason ?? '' }
      const again = options.shouldReconnect?.(full) ?? true
      if (again) connect()
      else state = 'closed'
      closed.emit(full)
    },
    raiseError() {
      errored.emit()
    },
  }
}
