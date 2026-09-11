/**
 * 往一条**已经关掉**的连接上发消息不许抛。
 *
 * 这是第 27b 条联机端到端跑完时 `wrangler dev` 日志里那两条未捕获错误
 *（`Uncaught TypeError: Can't call WebSocket send() after close()`，一个座位一条）。
 *
 * 出处是房间收摊那条路上的一个时间差：`closeRoom` 先把两个座位的连接都关掉，
 * 再 `await` 撤定时任务、把房间码还给大厅（后者是一次跨对象 RPC），
 * 而**记录是调用方在那之后才存盘的**。这两次 await 之间到达的 `webSocketClose` 事件
 * 从 SQLite 读回来的还是一份「没收摊」的记录，于是照常去 `broadcastPeer`，
 * 一发就发在刚关掉的那两条连接上——workerd 对这种情况是当场抛，不是静默丢弃。
 *
 * 修在 `send` 这一层（见 src/net/session.ts）：上面每一层遇到「连接已经没了」
 * 要做的事都一样——跳过。所以这份测试也断在那一层，不去重演那个时间差
 *（要重演就得卡在 RPC 的 await 中间，那种测试比它要守的代码还脆）。
 */

import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { send } from '../src/net/session'
import { tokenFor } from './accounts'
import { Client, HELLO, setupRoom } from './helpers'

/** 随便一条服务端消息，内容不重要——这里验的是「发不发得出去」。 */
const NOTICE = { type: 'room:closed', reason: 'peer-left', notice: '对手离开了房间' } as const

describe('往关掉的连接上发消息', () => {
  it('关掉之后再发不抛，也发不出去', async () => {
    await setupRoom('4030', ['alice', 'bob'])
    const alice = await Client.connect('4030', await tokenFor('alice'))
    alice.send(HELLO)
    await alice.expect('session:welcome')
    await alice.expect('room:peer')

    await runInDurableObject(env.MATCH_ROOM.getByName('4030'), (_instance, state) => {
      const ws = state.getWebSockets()[0]
      if (ws === undefined) throw new Error('房间里没有连接')

      // 先确认这条连接本来是发得出去的，免得下面那条断言因为别的原因也过。
      expect(() => send(ws, NOTICE)).not.toThrow()

      ws.close(1000, 'test')
      // 没有那道守卫的话，这一句在 workerd 里会抛
      // `TypeError: Can't call WebSocket send() after close()`。
      expect(() => send(ws, NOTICE)).not.toThrow()
    })

    alice.close()
  })

  it('有人离开之后房间照常收摊，两边都拿得到 room:closed', async () => {
    // 守卫不能把该发的也一起挡掉：收摊时那条 `room:closed` 是在 close() **之前**发的，
    // 连接那时还开着，必须照常送到。
    await setupRoom('4031', ['alice', 'bob'])
    const alice = await Client.connect('4031', await tokenFor('alice'))
    const bob = await Client.connect('4031', await tokenFor('bob'))
    for (const client of [alice, bob]) {
      client.send(HELLO)
      await client.expect('session:welcome')
    }

    alice.send({ type: 'room:leave' })
    for (const client of [alice, bob]) {
      expect((await client.until('room:closed')).reason).toBe('peer-left')
    }
  })
})
