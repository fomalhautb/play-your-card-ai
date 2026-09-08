/**
 * 两个客户端打完整一局，一路验裁剪、序号和快照。
 *
 * 这是《正式版架构》6.7 那条「两个 WebSocket 客户端打完整局」，
 * 也是需求第 6 条「隐藏信息不下发」在服务端这一侧的验收：
 * 断言的对象是**电线上真的出现过的每一条消息**，不是内部函数的返回值。
 */

import type { PlayerId } from '@ai-duel/core'
import { viewFor } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import { openDuel, playToEnd } from './duel'
import { authoritativeState, Client, HELLO, setupRoom, signToken } from './helpers'

describe('一局打到底', () => {
  it('两个客户端从装载打到 GAME_OVER，序号各自连续', async () => {
    const duel = await openDuel('2000')
    await playToEnd(duel)

    for (const side of duel.sides) {
      // 序号从 1 起、每条 +1（协议 README「序号和重同步」第 1、2 条）。
      expect(side.seqs[0]).toBe(1)
      expect(side.seqs).toEqual(side.seqs.map((_, index) => index + 1))
      expect(side.events.some((event) => event.type === 'GAME_OVER')).toBe(true)
    }

    // 终局之后房间自己收摊，两边都拿到 room:closed 再被关掉。
    for (const side of duel.sides) {
      const closed = await side.client.until('room:closed')
      expect(closed.reason).toBe('match-over')
      expect((await side.client.waitClosed()).code).toBe(1000)
    }
  })

  it('对手的手牌一个字都不下发', async () => {
    // 顺带带上一位已实装的英雄，走一遍带英雄的开局。
    const duel = await openDuel('2001', 'ada-lovelace')
    await playToEnd(duel)
    for (const side of duel.sides) {
      // OpponentView 里压根没有 hand 这个字段，只有张数（见 core 的 view.ts）。
      expect('hand' in side.view.opponent).toBe(false)
      expect(side.view.opponent.handCount).toBeGreaterThanOrEqual(0)
      // 牌堆内容和顺序两边都不给，自己的也不给。
      expect('deck' in side.view.self).toBe(false)
    }
  })

  it('对手摸牌只知道「他多了一张」，牌面不给', async () => {
    const duel = await openDuel('2002')
    await playToEnd(duel)
    for (const side of duel.sides) {
      const draws = side.events.filter((event) => event.type === 'CARD_DRAWN')
      expect(draws.length).toBeGreaterThan(0)
      for (const draw of draws) {
        if (draw.player === side.seat) expect(draw.card).toBeDefined()
        // 对手那几条被 filterEvent 摘掉了牌面和实例 id。
        else expect(draw.card).toBeUndefined()
      }
    }
  })

  it('出牌阶段只给类别和关键词，题面和答案都还遮着', async () => {
    const duel = await openDuel('2003')
    // 开局第一件事就是出牌阶段，此刻本轮那道题只该露出关键词。
    const current = duel.sides[0].view.questions[0]
    expect(current?.reveal).toBe('keywords')
    expect(current && 'answer' in current).toBe(false)
    expect(current && 'text' in current).toBe(false)
  })

  it('事件批里的视图不带卡池，开局和快照才带', async () => {
    const duel = await openDuel('2004')
    // match:started 的是完整 PlayerView。
    expect(duel.sides[0].view.catalog).toBeDefined()
    duel.sides[0].client.send({ type: 'match:command', command: { type: 'END_PLAY', player: 0 } })
    const seat = duel.sides[0].view.activePlayer
    // 先手不一定是 0 号，不是的话上面那条会被引擎拒掉，换一条合法的再来。
    if (seat !== 0) {
      await duel.sides[0].client.expect('match:rejected')
      duel.sides[1].client.send({ type: 'match:command', command: { type: 'END_PLAY', player: 1 } })
    }
    const batch = await duel.sides[0].client.expect('match:events')
    expect('catalog' in batch.view).toBe(false)
  })

  it('快照和服务端算出来的裁剪视图逐字相等', async () => {
    const duel = await openDuel('2005')
    const state = await authoritativeState('2005')
    for (const side of duel.sides) {
      side.client.send({ type: 'room:resync', haveSeq: side.seqs.at(-1) ?? 0 })
      const snapshot = await side.client.expect('match:snapshot')
      expect(snapshot.seq).toBe(side.seqs.at(-1))
      expect(snapshot.view).toEqual(viewFor(state, side.seat))
    }
  })

  it('断线重连：座位不变，resync 回快照', async () => {
    const duel = await openDuel('2006')
    const before = await authoritativeState('2006')
    duel.sides[0].client.close()
    // 对手会看到掉线，收到之后再重连，免得和下面那条 room:peer 撞在一起。
    expect((await duel.sides[1].client.until('room:peer')).online).toBe(false)

    const again = await Client.connect('2006', await signToken('alice'))
    again.send(HELLO)
    const welcome = await again.expect('session:welcome')
    expect(welcome.place).toEqual({ kind: 'room', code: '2006', seat: 0 })

    again.send({ type: 'room:resync', haveSeq: 0 })
    const snapshot = await again.until('match:snapshot')
    // 不补发漏掉的事件，只给当前局面（协议 README 第 5 条）。
    expect(snapshot.view).toEqual(viewFor(before, 0 as PlayerId))
    expect(snapshot.view.catalog).toBeDefined()
    again.close()
  })

  it('对手在线/装载/就绪每一步都全量报一次', async () => {
    await setupRoom('2007', ['alice', 'bob'])
    const alice = await Client.connect('2007', await signToken('alice'))
    alice.send(HELLO)
    await alice.expect('session:welcome')
    // 此刻 bob 还没连上。
    expect(await alice.expect('room:peer')).toMatchObject({
      seat: 1,
      online: false,
      loaded: false,
      ready: false,
    })

    const bob = await Client.connect('2007', await signToken('bob'))
    bob.send(HELLO)
    await bob.expect('session:welcome')
    expect(await alice.expect('room:peer')).toMatchObject({ seat: 1, online: true, loaded: false })
    alice.close()
    bob.close()
  })
})
