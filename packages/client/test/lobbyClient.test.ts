/**
 * 大厅客户端：三条路各拿一次房间码，加上退队和四种失败。
 *
 * 大厅的成功路径都长一样（`lobby:room`），所以真正要盯的是**失败怎么收场**——
 * 一个永远挂着的 Promise 在界面上就是一个转不完的圈。
 */

import type { RoomCode } from '@ai-duel/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import type { LobbyClient } from '../src/net/lobbyClient'
import { createLobbyClient, LobbyError } from '../src/net/lobbyClient'
import { createHarness, type Harness } from './helpers/harness'

const CODE: RoomCode = '4821'

const clients: LobbyClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
})

/** 开一个大厅客户端并握完手，之后发出去的消息才不会被压着。 */
function open(): { harness: Harness; client: LobbyClient } {
  const harness = createHarness()
  const client = createLobbyClient({
    network: harness.platform.network,
    url: () => 'http://127.0.0.1:8787/lobby',
    token: () => Promise.resolve('a.b.c'),
  })
  clients.push(client)
  harness.socket().acceptConnection()
  harness.deliver({
    type: 'session:welcome',
    protocolVersion: 1,
    userId: 'u-1',
    place: { kind: 'lobby' },
  })
  return { harness, client }
}

/** 断言一个 Promise 以某个 LobbyError 收场，并把 reason 交出来。 */
async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof LobbyError) return error.reason
    throw error
  }
  throw new Error('这个请求本该失败')
}

describe('三条路进房间', () => {
  it('排队：先入队回执，配上人才给码', async () => {
    const { harness, client } = open()
    const pending = client.joinQueue()
    expect(harness.sent().at(-1)).toEqual({ type: 'lobby:queue' })

    // 入队回执不结束这次请求，房间码还在后头。
    harness.deliver({ type: 'lobby:queued' })
    harness.deliver({ type: 'lobby:room', code: CODE, origin: 'queue' })
    await expect(pending).resolves.toBe(CODE)
  })

  it('私人开房', async () => {
    const { harness, client } = open()
    const pending = client.createRoom()
    expect(harness.sent().at(-1)).toEqual({ type: 'lobby:create' })

    harness.deliver({ type: 'lobby:room', code: CODE, origin: 'create' })
    await expect(pending).resolves.toBe(CODE)
  })

  it('按码加入', async () => {
    const { harness, client } = open()
    const pending = client.joinRoom(CODE)
    expect(harness.sent().at(-1)).toEqual({ type: 'lobby:join', code: CODE })

    harness.deliver({ type: 'lobby:room', code: CODE, origin: 'join' })
    await expect(pending).resolves.toBe(CODE)
  })

  it('拿到码就把大厅这条连接收掉', async () => {
    const { harness, client } = open()
    const pending = client.joinQueue()
    harness.deliver({ type: 'lobby:room', code: CODE, origin: 'queue' })
    await pending

    // 房间是另一个 Durable Object，一条连接跨不过去；服务端也不会替客户端关。
    expect(harness.socket().state).toBe('closed')
  })
})

describe('退队', () => {
  it('回执到了就 resolve，挂着的排队请求一起了断', async () => {
    const { harness, client } = open()
    const queued = client.joinQueue()
    const canceling = client.cancel()
    expect(harness.sent().at(-1)).toEqual({ type: 'lobby:cancel' })

    harness.deliver({ type: 'lobby:canceled' })
    await expect(canceling).resolves.toBeUndefined()
    expect(await reasonOf(queued)).toBe('closed')
  })
})

describe('失败', () => {
  it('lobby:error 把挂着的请求全部结掉，reason 原样交出去', async () => {
    const { harness, client } = open()
    const pending = client.joinRoom('9999')
    harness.deliver({ type: 'lobby:error', reason: 'room-not-found', notice: '没有这个房间' })

    await expect(pending).rejects.toThrow('没有这个房间')
  })

  it('notice 是空串时退回用 reason 当文案', async () => {
    const { harness, client } = open()
    const pending = client.joinQueue()
    harness.deliver({ type: 'lobby:error', reason: 'already-queued', notice: '' })

    await expect(pending).rejects.toThrow('already-queued')
  })

  it('连接断了当这次请求失败：服务端在断线那一刻就把人移出了队列', async () => {
    const { harness, client } = open()
    const pending = client.joinQueue()
    harness.socket().dropConnection({ code: 1006 })

    expect(await reasonOf(pending)).toBe('link-down')
  })

  it('进不去大厅（token 无效）也要有个了断', async () => {
    const { harness, client } = open()
    const pending = client.joinQueue()
    harness.deliver({ type: 'session:rejected', reason: 'unauthorized', notice: '登录状态无效' })

    expect(await reasonOf(pending)).toBe('rejected')
  })

  it('主动关掉大厅时挂着的请求一起失败', async () => {
    const { client } = open()
    const pending = client.joinQueue()
    client.close()

    expect(await reasonOf(pending)).toBe('closed')
  })

  it('同一时刻只等一个房间码，新的请求顶掉旧的', async () => {
    const { client } = open()
    const first = client.joinQueue()
    const second = client.createRoom()

    expect(await reasonOf(first)).toBe('closed')
    // 顶掉旧的不影响新的：它还等着自己的答复。
    client.close()
    expect(await reasonOf(second)).toBe('closed')
  })
})
