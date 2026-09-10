/**
 * 握手这一段：带 JWT 上来、版本比对、座位分配、顶掉旧连接。
 *
 * 进不去的那几条都断言**两样东西**：`session:rejected` 的 reason 和关闭码。
 * 两样都要，是因为消息万一没送到（连接先断了），客户端只剩关闭码可认（协议 README「认证」）。
 */

import {
  CLOSE_PROTOCOL_VERSION,
  CLOSE_ROOM_FULL,
  CLOSE_ROOM_NOT_FOUND,
  CLOSE_SUPERSEDED,
  CLOSE_UNAUTHORIZED,
  PROTOCOL_VERSION,
  subprotocolsFor,
  WIRE_SUBPROTOCOL,
} from '@ai-duel/protocol'
import { describe, expect, it } from 'vitest'
import { accountId, expiredToken, forgedToken, tokenFor } from './accounts'
import { Client, setupRoom } from './helpers'

const HELLO = {
  type: 'session:hello',
  protocolVersion: PROTOCOL_VERSION,
  clientVersion: '0.0.0-test',
} as const

describe('房间握手', () => {
  it('带对的 token 能进，101 只回显 ai-duel，welcome 带座位', async () => {
    await setupRoom('1000', ['alice', 'bob'])
    const alice = await Client.connect('1000', await tokenFor('alice'))

    // 回显必须只有 ai-duel：把带 token 的那个子协议回显出去等于把凭据写进响应头。
    expect(alice.response.headers.get('Sec-WebSocket-Protocol')).toBe(WIRE_SUBPROTOCOL)

    alice.send(HELLO)
    const welcome = await alice.expect('session:welcome')
    expect(welcome.userId).toBe(await accountId('alice'))
    expect(welcome.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(welcome.place).toEqual({ kind: 'room', code: '1000', seat: 0 })
    alice.close()
  })

  it('座位号由服务端按建房时的名单分，客户端说了不算', async () => {
    await setupRoom('1001', ['alice', 'bob'])
    const bob = await Client.connect('1001', await tokenFor('bob'))
    bob.send(HELLO)
    const welcome = await bob.expect('session:welcome')
    expect(welcome.place).toEqual({ kind: 'room', code: '1001', seat: 1 })
    bob.close()
  })

  it('连子协议头都不带的，先 101 再 4401', async () => {
    await setupRoom('1002', ['alice', 'bob'])
    const stranger = await Client.connectRaw('1002', null)
    const rejected = await stranger.expect('session:rejected')
    expect(rejected.reason).toBe('unauthorized')
    expect((await stranger.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED)
  })

  it('只提 ai-duel、不带 jwt. 的，一样进不去', async () => {
    await setupRoom('1003', ['alice', 'bob'])
    const stranger = await Client.connectRaw('1003', WIRE_SUBPROTOCOL)
    expect((await stranger.expect('session:rejected')).reason).toBe('unauthorized')
    expect((await stranger.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED)
  })

  it('伪造签名的 token 进不去', async () => {
    await setupRoom('1004', ['alice', 'bob'])
    const forger = await Client.connect('1004', await forgedToken('alice'))
    expect((await forger.expect('session:rejected')).reason).toBe('unauthorized')
    expect((await forger.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED)
  })

  it('过期的 token 进不去', async () => {
    await setupRoom('1005', ['alice', 'bob'])
    const late = await Client.connect('1005', await expiredToken('alice'))
    expect((await late.expect('session:rejected')).reason).toBe('unauthorized')
    expect((await late.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED)
  })

  it('第三个人进不了满房', async () => {
    await setupRoom('1006', ['alice', 'bob'])
    const carol = await Client.connect('1006', await tokenFor('carol'))
    expect((await carol.expect('session:rejected')).reason).toBe('room-full')
    expect((await carol.waitClosed()).code).toBe(CLOSE_ROOM_FULL)
  })

  it('房间还没建就来连的，回 room-not-found', async () => {
    const early = await Client.connect('1007', await tokenFor('alice'))
    expect((await early.expect('session:rejected')).reason).toBe('room-not-found')
    expect((await early.waitClosed()).code).toBe(CLOSE_ROOM_NOT_FOUND)
  })

  it('协议版本对不上：先说清楚再关，不是握手那一步失败', async () => {
    await setupRoom('1008', ['alice', 'bob'])
    const old = await Client.connect('1008', await tokenFor('alice'))
    // 握手本身是成功的——版本号故意不写进子协议名，就是为了让服务端有机会把原因说出口。
    expect(old.response.headers.get('Sec-WebSocket-Protocol')).toBe(WIRE_SUBPROTOCOL)
    old.send({ ...HELLO, protocolVersion: PROTOCOL_VERSION + 1 })
    const rejected = await old.expect('session:rejected')
    expect(rejected.reason).toBe('protocol-version')
    expect(rejected.notice.length).toBeGreaterThan(0)
    expect((await old.waitClosed()).code).toBe(CLOSE_PROTOCOL_VERSION)
  })

  it('同一个账号再连一条，旧的被顶掉，座位不变', async () => {
    await setupRoom('1009', ['alice', 'bob'])
    const first = await Client.connect('1009', await tokenFor('alice'))
    first.send(HELLO)
    await first.expect('session:welcome')
    // welcome 之后紧跟一条对手状态，先取掉，下面等的才是顶号那条。
    await first.expect('room:peer')

    const second = await Client.connect('1009', await tokenFor('alice'))
    const superseded = await first.expect('session:rejected')
    expect(superseded.reason).toBe('superseded')
    expect((await first.waitClosed()).code).toBe(CLOSE_SUPERSEDED)

    second.send(HELLO)
    expect((await second.expect('session:welcome')).place).toEqual({
      kind: 'room',
      code: '1009',
      seat: 0,
    })
    second.close()
  })

  it('没打招呼就发别的消息，一律不认', async () => {
    await setupRoom('1010', ['alice', 'bob'])
    const alice = await Client.connect('1010', await tokenFor('alice'))
    alice.send({ type: 'room:ready' })
    expect((await alice.expect('room:error')).reason).toBe('malformed')
    alice.close()
  })

  it('乱码和不是发给房间的消息都回 malformed', async () => {
    await setupRoom('1011', ['alice', 'bob'])
    const alice = await Client.connect('1011', await tokenFor('alice'))
    alice.send(HELLO)
    await alice.expect('session:welcome')
    await alice.expect('room:peer')

    alice.sendRaw('{ 这不是 JSON')
    expect((await alice.expect('room:error')).reason).toBe('malformed')

    // 大厅的消息发到房间来也一样：房间只认 room: 和 match: 那几种。
    alice.send({ type: 'lobby:queue' })
    expect((await alice.expect('room:error')).reason).toBe('malformed')
    alice.close()
  })

  it('子协议里的 token 不会被回显出去', async () => {
    await setupRoom('1012', ['alice', 'bob'])
    const token = await tokenFor('alice')
    const alice = await Client.connect('1012', token)
    const echoed = alice.response.headers.get('Sec-WebSocket-Protocol') ?? ''
    expect(echoed).not.toContain(token)
    expect(subprotocolsFor(token)[1]).toContain(token)
    alice.close()
  })
})
