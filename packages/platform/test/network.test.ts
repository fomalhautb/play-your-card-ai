// @vitest-environment happy-dom
/**
 * 重连状态机。
 *
 * web 实现底下是 partysocket，测试给它塞一个假的原生 WebSocket（见 FakeWebSocket），
 * 于是「握手成功、断线、被业务拒绝」这些时机全由脚本说了算，不用真起一个服务器。
 * 假实现照着同一套语义写，所以两边跑同一组断言——对不上就说明假实现在骗人。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePlatform } from '../src/index'
import { createWebNetwork } from '../src/web/network'

/** partysocket 的 close 事件靠 code / reason 两个字段认，所以要带着它们发。 */
class FakeCloseEvent extends Event {
  readonly code: number
  readonly reason: string
  constructor(code: number, reason: string) {
    super('close')
    this.code = code
    this.reason = reason
  }
}

/** 一个够 partysocket 用的假原生 WebSocket：它只要 addEventListener、send、close 和 readyState。 */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []
  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1)
    if (socket === undefined) throw new Error('还没有连接被建出来')
    return socket
  }

  readonly url: string
  /** 建连接时提的子协议。JWT 就走这里（见 protocol 的 handshake.ts）。 */
  readonly protocols: string | string[] | undefined
  binaryType = 'blob'
  readyState = 0
  readonly sent: string[] = []

  constructor(url: string, protocols?: string | string[]) {
    super()
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
  }

  /** 服务端接受了这次握手。 */
  accept(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  /** 服务端发来一帧。 */
  deliver(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
  /** 连接断了。1006 是「链路断了」，4000 往上是服务端的业务拒绝。 */
  serverClose(code: number, reason = ''): void {
    this.readyState = 3
    this.dispatchEvent(new FakeCloseEvent(code, reason))
  }
}

/** 退避压到 10 毫秒，握手超时放大到远超测试里推进的时间，免得误触发。 */
const TUNING = { minReconnectDelayMs: 10, maxReconnectDelayMs: 10, connectTimeoutMs: 60_000 }

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 等退避走完、连接建出来。 */
async function settleConnect(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50)
}

describe('web 实现的重连', () => {
  it('建出来是 connecting，握手成功才是 open', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    const socket = network.openSocket({ url: () => 'wss://x/room', ...TUNING })
    expect(socket.state).toBe('connecting')

    await settleConnect()
    FakeWebSocket.last().accept()
    expect(socket.state).toBe('open')
  })

  it('连接没通时发的帧排队，连上一次性补发', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    const socket = network.openSocket({ url: () => 'wss://x/room', ...TUNING })
    socket.send('第一条')
    await settleConnect()
    // 还没握手成功，帧不该出去——裸 WebSocket 这时是静默丢弃的。
    expect(FakeWebSocket.last().sent).toEqual([])

    FakeWebSocket.last().accept()
    socket.send('第二条')
    expect(FakeWebSocket.last().sent).toEqual(['第一条', '第二条'])
  })

  it('只转发文本帧', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    const socket = network.openSocket({ url: () => 'wss://x/room', ...TUNING })
    const frames: string[] = []
    socket.onMessage((frame) => frames.push(frame))

    await settleConnect()
    FakeWebSocket.last().accept()
    FakeWebSocket.last().deliver('#room:ok')
    FakeWebSocket.last().deliver(new ArrayBuffer(4))
    expect(frames).toEqual(['#room:ok'])
  })

  it('断线之后自己重连，地址每次现算', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    let joined = false
    const socket = network.openSocket({
      // 重连要带 resume 参数，所以地址必须每次现算，不能建连接时定死。
      url: () => `wss://x/room${joined ? '?resume=1' : ''}`,
      ...TUNING,
    })
    await settleConnect()
    FakeWebSocket.last().accept()
    joined = true

    const closes: number[] = []
    socket.onClose((info) => closes.push(info.code))
    FakeWebSocket.last().serverClose(1006)
    expect(closes).toEqual([1006])
    // 还打算连回去，所以是 connecting 不是 closed。
    expect(socket.state).toBe('connecting')

    await settleConnect()
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.last().url).toBe('wss://x/room?resume=1')
  })

  it('业务拒绝就不再重试', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    const socket = network.openSocket({
      url: () => 'wss://x/room',
      ...TUNING,
      // 房间不存在、已满、被占：再试多少次都是同样的结果。
      shouldReconnect: (info) => info.code < 4000,
    })
    await settleConnect()
    FakeWebSocket.last().accept()

    const reasons: string[] = []
    socket.onClose((info) => reasons.push(info.reason))
    FakeWebSocket.last().serverClose(4001, '房间已满')

    expect(reasons).toEqual(['房间已满'])
    expect(socket.state).toBe('closed')
    await settleConnect()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('主动重连立刻换一条连接，不等退避', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    const socket = network.openSocket({ url: () => 'wss://x/room', ...TUNING })
    await settleConnect()
    FakeWebSocket.last().accept()

    // 心跳超时判定半开连接时走的就是这条路：socket 还显示连着，数据其实出不去。
    socket.reconnect()
    expect(socket.state).toBe('connecting')
    await settleConnect()
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('子协议每次现取，重连换一份新的', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    let token = '第一张'
    const socket = network.openSocket({
      // 凭据是短时效的，挂久了重连必须现换一张，所以这一项和 url 一样是函数。
      protocols: () => Promise.resolve(['ai-duel', `jwt.${token}`]),
      url: () => 'wss://x/room',
      ...TUNING,
    })
    await settleConnect()
    expect(FakeWebSocket.last().protocols).toEqual(['ai-duel', 'jwt.第一张'])

    token = '第二张'
    socket.reconnect()
    await settleConnect()
    expect(FakeWebSocket.last().protocols).toEqual(['ai-duel', 'jwt.第二张'])
  })

  it('关掉之后就是终态，不再有新连接', async () => {
    const network = createWebNetwork({ webSocket: FakeWebSocket })
    const socket = network.openSocket({ url: () => 'wss://x/room', ...TUNING })
    await settleConnect()
    FakeWebSocket.last().accept()

    socket.close()
    expect(socket.state).toBe('closed')
    await settleConnect()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

describe('假实现的重连', () => {
  it('走一遍和 web 实现同样的状态机', () => {
    const { network } = createFakePlatform()
    let joined = false
    const socket = network.openSocket({
      url: () => `wss://x/room${joined ? '?resume=1' : ''}`,
      shouldReconnect: (info) => info.code < 4000,
    })
    expect(socket.state).toBe('connecting')

    socket.send('排队的一条')
    const fake = network.sockets[0]!
    fake.acceptConnection()
    joined = true
    expect(socket.state).toBe('open')
    expect(fake.sent).toEqual(['排队的一条'])

    const frames: string[] = []
    socket.onMessage((frame) => frames.push(frame))
    fake.deliver('#room:ok')
    expect(frames).toEqual(['#room:ok'])

    fake.dropConnection({ code: 1006 })
    expect(socket.state).toBe('connecting')
    expect(fake.urls).toEqual(['wss://x/room', 'wss://x/room?resume=1'])

    fake.acceptConnection()
    fake.dropConnection({ code: 4001, reason: '房间已满' })
    expect(socket.state).toBe('closed')
    expect(fake.urls).toHaveLength(2)
  })

  it('子协议按每次连接分别记下来，下标和 urls 对齐', async () => {
    const { network } = createFakePlatform()
    let token = '第一张'
    const socket = network.openSocket({
      protocols: () => Promise.resolve([`jwt.${token}`]),
      url: () => 'wss://x/room',
    })
    const fake = network.sockets[0]!
    fake.acceptConnection()

    token = '第二张'
    socket.reconnect()
    // 取子协议是异步的（换凭据要走一次请求），把微任务放干净再看。
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.protocols).toEqual([['jwt.第一张'], ['jwt.第二张']])
  })

  it('requestJson 只答配过的地址', async () => {
    const { network } = createFakePlatform()
    network.respondWith('/api/room', { code: '4821' })
    await expect(network.requestJson('/api/room')).resolves.toEqual({ code: '4821' })
    await expect(network.requestJson('/api/别的')).rejects.toThrow()
  })

  it('能触发一次「回到前台」', () => {
    const { network } = createFakePlatform()
    let calls = 0
    const off = network.onForeground(() => {
      calls += 1
    })
    network.enterForeground()
    off()
    network.enterForeground()
    expect(calls).toBe(1)
  })
})
