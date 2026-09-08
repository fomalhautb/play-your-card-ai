/**
 * 大厅：排队配对、私人开房、按码加入，以及房间码的回收（迁移第 24 条）。
 *
 * 全部走真的 WebSocket，房间码一律由服务端摇——测试事先并不知道会摇出哪个码，
 * 这正是要验的东西之一（客户端只能拿着 `lobby:room` 给的那个码去连房间）。
 */

import { describe, expect, it } from 'vitest'
import { enterDuel, playToEnd } from './duel'
import { Client, expireAlarm, fireRoomAlarm, HELLO, signToken } from './helpers'

/** 排队并拿到配对结果。`lobby:queued` 是入队回执，`lobby:room` 是配上之后才来的。 */
async function queueUp(client: Client): Promise<void> {
  client.send({ type: 'lobby:queue' })
  await client.expect('lobby:queued')
}

describe('大厅握手', () => {
  it('welcome 说的是大厅，没有座位号', async () => {
    const client = await Client.connectLobby(await signToken('lucy'))
    client.send(HELLO)
    const welcome = await client.expect('session:welcome')
    expect(welcome.userId).toBe('lucy')
    expect(welcome.place).toEqual({ kind: 'lobby' })
    client.close()
  })
})

describe('排队匹配', () => {
  it('两个人排上队，各收到同一个房间码，连过去能开局', async () => {
    const alice = await Client.openLobby('q-alice')
    const bob = await Client.openLobby('q-bob')
    await queueUp(alice)
    await queueUp(bob)

    const first = await alice.expect('lobby:room')
    const second = await bob.expect('lobby:room')
    expect(first.code).toBe(second.code)
    expect(first.origin).toBe('queue')
    expect(second.origin).toBe('queue')
    // 拿到码就该断开大厅，另开一条连接去连房间（协议 README「两条连接」）。
    alice.close()
    bob.close()

    // 座位按配对时的先后分：先排上队的是 0 号座。
    const duel = await enterDuel(first.code, ['q-alice', 'q-bob'])
    await playToEnd(duel)
    for (const side of duel.sides) {
      expect(side.events.some((event) => event.type === 'GAME_OVER')).toBe(true)
    }
  })

  it('先到的两个先配上，第三个留在队里', async () => {
    const first = await Client.openLobby('order-1')
    const second = await Client.openLobby('order-2')
    const third = await Client.openLobby('order-3')
    await queueUp(first)
    await queueUp(second)
    await queueUp(third)

    await first.expect('lobby:room')
    await second.expect('lobby:room')
    // 第三个人只拿到了入队回执，没有房间码。
    expect(third.pending()).toBe(0)
    for (const client of [first, second, third]) client.close()
  })

  it('已经在队里再排一次要被拒', async () => {
    const client = await Client.openLobby('dup')
    await queueUp(client)
    client.send({ type: 'lobby:queue' })
    expect((await client.expect('lobby:error')).reason).toBe('already-queued')
    client.close()
  })

  it('取消要先在队里，不在队里发取消被拒', async () => {
    const client = await Client.openLobby('cancel-me')
    client.send({ type: 'lobby:cancel' })
    expect((await client.expect('lobby:error')).reason).toBe('not-queued')

    await queueUp(client)
    client.send({ type: 'lobby:cancel' })
    await client.expect('lobby:canceled')
    // 取消之后真的不在队里了：再取消一次又是 not-queued。
    client.send({ type: 'lobby:cancel' })
    expect((await client.expect('lobby:error')).reason).toBe('not-queued')
    client.close()
  })

  it('排队之后断线的人会被拿出队列，不占配对名额', async () => {
    const leaver = await Client.openLobby('gone')
    await queueUp(leaver)
    leaver.close()

    const stayer = await Client.openLobby('stay')
    await queueUp(stayer)
    // 掉线的那个如果还占着队列，这两个人就配上了。
    expect(stayer.pending()).toBe(0)

    const partner = await Client.openLobby('partner')
    await queueUp(partner)
    const room = await stayer.expect('lobby:room')
    expect((await partner.expect('lobby:room')).code).toBe(room.code)
    stayer.close()
    partner.close()
  })
})

describe('私人开房', () => {
  it('开房拿码、朋友按码进来，两个人都能连房间', async () => {
    const host = await Client.openLobby('host')
    host.send({ type: 'lobby:create' })
    const created = await host.expect('lobby:room')
    expect(created.origin).toBe('create')

    const guest = await Client.openLobby('guest')
    guest.send({ type: 'lobby:join', code: created.code })
    const joined = await guest.expect('lobby:room')
    expect(joined).toEqual({ type: 'lobby:room', code: created.code, origin: 'join' })
    host.close()
    guest.close()

    const duel = await enterDuel(created.code, ['host', 'guest'])
    expect(duel.sides[0].view.catalog).toBeDefined()
  })

  it('打错的房间码停在大厅这一层', async () => {
    const client = await Client.openLobby('typo')
    client.send({ type: 'lobby:join', code: '9999' })
    expect((await client.expect('lobby:error')).reason).toBe('room-not-found')
    client.close()
  })

  it('第三个人进不去已经满了的房', async () => {
    const host = await Client.openLobby('full-host')
    host.send({ type: 'lobby:create' })
    const created = await host.expect('lobby:room')

    const guest = await Client.openLobby('full-guest')
    guest.send({ type: 'lobby:join', code: created.code })
    await guest.expect('lobby:room')

    const extra = await Client.openLobby('full-extra')
    extra.send({ type: 'lobby:join', code: created.code })
    expect((await extra.expect('lobby:error')).reason).toBe('room-full')
    for (const client of [host, guest, extra]) client.close()
  })

  it('开房的人自己再按码进一次还是同一个房', async () => {
    const host = await Client.openLobby('again')
    host.send({ type: 'lobby:create' })
    const created = await host.expect('lobby:room')
    host.send({ type: 'lobby:join', code: created.code })
    const again = await host.expect('lobby:room')
    expect(again.code).toBe(created.code)
    expect(again.origin).toBe('join')
    host.close()
  })

  it('没带房间码的 lobby:join 过不了 schema，回一句缺什么', async () => {
    const client = await Client.openLobby('no-code')
    client.sendRaw(JSON.stringify({ type: 'lobby:join' }))
    expect((await client.expect('lobby:error')).reason).toBe('no-room-code')
    client.close()
  })
})

describe('房间码回收', () => {
  it('房间收摊之后码被还回大厅，再用这个码加入就是「没有这个房间」', async () => {
    const host = await Client.openLobby('recycle-host')
    host.send({ type: 'lobby:create' })
    const created = await host.expect('lobby:room')
    host.close()

    // 没人来，空房超时把房间关掉，房间在收摊时把码还给大厅。
    await expireAlarm(created.code, 'idle')
    expect(await fireRoomAlarm(created.code)).toBe(true)

    const late = await Client.openLobby('recycle-late')
    late.send({ type: 'lobby:join', code: created.code })
    expect((await late.expect('lobby:error')).reason).toBe('room-not-found')
    late.close()
  })

  it('一局打完之后码也回收', async () => {
    const alice = await Client.openLobby('over-alice')
    const bob = await Client.openLobby('over-bob')
    await queueUp(alice)
    await queueUp(bob)
    const room = await alice.expect('lobby:room')
    await bob.expect('lobby:room')
    alice.close()
    bob.close()

    const duel = await enterDuel(room.code, ['over-alice', 'over-bob'])
    await playToEnd(duel)
    for (const side of duel.sides) await side.client.until('room:closed')

    const late = await Client.openLobby('over-late')
    late.send({ type: 'lobby:join', code: room.code })
    expect((await late.expect('lobby:error')).reason).toBe('room-not-found')
    late.close()
  })
})
