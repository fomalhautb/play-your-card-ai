/**
 * 会话层：凭据怎么上去、打招呼之前的消息压在哪、心跳怎么识破半开连接、
 * 哪些关闭码不该重连。
 *
 * 这几条都不是 driver 的事，但每一条错了都会以「联机偶尔连不上」的形式冒出来，
 * 所以单独一组测试盯着。
 */

import type { ServerMessage, SessionRejectedReason, WelcomePlace } from '@ai-duel/protocol'
import { HEARTBEAT_PING, HEARTBEAT_PONG, WIRE_SUBPROTOCOL } from '@ai-duel/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/net/session'
import { openSession } from '../src/net/session'
import { createHarness, type Harness } from './helpers/harness'

const TOKEN = 'a.b.c'

interface Opened {
  harness: Harness
  session: Session
  welcomes: WelcomePlace[]
  rejections: { reason: SessionRejectedReason; notice: string }[]
  messages: ServerMessage[]
  downs: number
}

const sessions: Session[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.close()
  vi.useRealTimers()
})

function open(): Opened {
  const harness = createHarness()
  const opened: Opened = {
    harness,
    welcomes: [],
    rejections: [],
    messages: [],
    downs: 0,
    session: undefined as unknown as Session,
  }
  opened.session = openSession({
    network: harness.platform.network,
    url: () => 'http://x/lobby',
    token: () => Promise.resolve(TOKEN),
    onWelcome: (place) => opened.welcomes.push(place),
    onRejected: (reason, notice) => opened.rejections.push({ reason, notice }),
    onMessage: (message) => opened.messages.push(message),
    onDown: () => {
      opened.downs += 1
    },
  })
  sessions.push(opened.session)
  return opened
}

function welcome(harness: Harness): void {
  harness.socket().acceptConnection()
  harness.deliver({
    type: 'session:welcome',
    protocolVersion: 1,
    userId: 'u-1',
    place: { kind: 'lobby' },
  })
}

describe('凭据', () => {
  it('每次连接现取一张 token，和固定的子协议名一起提上去', async () => {
    const { harness } = open()
    // 取 token 要走一次请求，所以子协议是异步填上的：等一轮宏任务把整条链跑完。
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.socket().protocols[0]).toEqual([WIRE_SUBPROTOCOL, `jwt.${TOKEN}`])
  })
})

describe('打招呼', () => {
  it('连上第一条是 session:hello，业务消息压到 welcome 之后', () => {
    const { harness, session } = open()
    session.send({ type: 'lobby:queue' })

    harness.socket().acceptConnection()
    // 底层的排队补发排在 onOpen 之前，所以压这一道不能省：
    // 不压的话 lobby:queue 会跑到 hello 前头，被服务端当成「没打招呼就说话」。
    expect(harness.sent().map((message) => message.type)).toEqual(['session:hello'])

    harness.deliver({
      type: 'session:welcome',
      protocolVersion: 1,
      userId: 'u-1',
      place: { kind: 'lobby' },
    })
    expect(harness.sent().map((message) => message.type)).toEqual(['session:hello', 'lobby:queue'])
  })

  it('每次重连都重新打一次招呼', () => {
    const { harness } = open()
    welcome(harness)
    harness.socket().dropConnection({ code: 1006 })
    harness.socket().acceptConnection()

    const hellos = harness.sent().filter((message) => message.type === 'session:hello')
    expect(hellos).toHaveLength(2)
  })

  it('被拒之后不再重连，也不报一次多余的断线', () => {
    const { harness, ...opened } = open()
    harness.socket().acceptConnection()
    harness.deliver({ type: 'session:rejected', reason: 'unauthorized', notice: '登录状态无效' })

    expect(opened.rejections).toEqual([{ reason: 'unauthorized', notice: '登录状态无效' }])
    expect(harness.socket().state).toBe('closed')
    expect(opened.downs).toBe(0)
  })
})

describe('关闭码', () => {
  it('业务拒绝的那一段不重连，别的当网络问题重连', () => {
    const first = open()
    first.harness.socket().dropConnection({ code: 4404, reason: 'room-not-found' })
    expect(first.harness.socket().state).toBe('closed')
    expect(first.harness.socket().urls).toHaveLength(1)

    const second = open()
    second.harness.socket().dropConnection({ code: 1006 })
    expect(second.harness.socket().state).toBe('connecting')
    expect(second.harness.socket().urls).toHaveLength(2)
    expect(second.downs).toBe(1)
  })
})

describe('心跳', () => {
  it('闲着就发 ping，收到 pong 重新计时', () => {
    vi.useFakeTimers()
    const { harness } = open()
    welcome(harness)

    vi.advanceTimersByTime(15_000)
    expect(harness.rawSent().filter((frame) => frame === HEARTBEAT_PING)).toHaveLength(1)

    harness.socket().deliver(HEARTBEAT_PONG)
    vi.advanceTimersByTime(10_000)
    // 上一次 pong 之后才过了 10 秒，还不到发下一个 ping 的时候。
    expect(harness.rawSent().filter((frame) => frame === HEARTBEAT_PING)).toHaveLength(1)
  })

  it('发了 ping 等不到 pong 就换一条连接', () => {
    vi.useFakeTimers()
    const { harness } = open()
    welcome(harness)

    vi.advanceTimersByTime(15_000)
    expect(harness.socket().urls).toHaveLength(1)

    // 超过等 pong 的上限：socket 看着还开着，数据其实出不去。
    vi.advanceTimersByTime(25_000)
    expect(harness.socket().urls).toHaveLength(2)
  })

  it('回到前台立刻探一帧', () => {
    vi.useFakeTimers()
    const { harness } = open()
    welcome(harness)

    harness.platform.network.enterForeground()
    expect(harness.rawSent().filter((frame) => frame === HEARTBEAT_PING)).toHaveLength(1)
  })
})
