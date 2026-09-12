/**
 * 作弊测试（《正式版架构》6.7）：能想到的歪门邪道全试一遍，全部要被拒，而且**局面一个字都不变**。
 *
 * 「被拒」和「局面没变」要分开验：只验回了一条错误消息是不够的——
 * 真正的风险是服务端一边回错误一边把指令执行了。所以每条都拿房间 SQLite 里那份权威局面
 * 前后对一次账（`authoritativeState`）。
 *
 * 握手门口那几条（伪造 JWT、过期 token、没 token、版本不对、第三人进满房）在
 * handshake.test.ts 里，那些还没走到局面这一层。
 */

import { BALANCED_DECK } from '@ai-duel/content'
import { CLOSE_ROOM_FULL, CLOSE_SUPERSEDED } from '@ai-duel/protocol'
import { describe, expect, it } from 'vitest'
import { tokenFor } from './accounts'
import { openDuel } from './duel'
import { authoritativeState, Client, HELLO, setupRoom } from './helpers'

describe('作弊', () => {
  it('拿对方座位号发指令，被拒且局面不变', async () => {
    const duel = await openDuel('3000')
    const before = await authoritativeState('3000')

    // alice 坐 0 号，却报自己是 1 号想替对手结束出牌。
    duel.sides[0].client.send({
      type: 'match:command',
      command: { type: 'END_PLAY', player: 1 },
    })
    const error = await duel.sides[0].client.expect('room:error')
    expect(error.reason).toBe('not-your-seat')
    expect(await authoritativeState('3000')).toEqual(before)
    // 对手那边什么都不该收到：这条根本没进引擎。
    expect(duel.sides[1].client.pending()).toBe(0)
  })

  it('DEBUG_ 指令在解析层就进不来', async () => {
    const duel = await openDuel('3001')
    const before = await authoritativeState('3001')

    // DEBUG_SKIP_TO_QUIZ 能直接跳过对手的出牌回合。
    duel.sides[0].client.sendRaw(
      JSON.stringify({ type: 'match:command', command: { type: 'DEBUG_SKIP_TO_QUIZ' } }),
    )
    expect((await duel.sides[0].client.expect('room:error')).reason).toBe('malformed')

    // DEBUG_ADD_CARD 能凭空给自己造一张牌。
    duel.sides[0].client.sendRaw(
      JSON.stringify({
        type: 'match:command',
        command: { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'claude-fable-5' },
      }),
    )
    expect((await duel.sides[0].client.expect('room:error')).reason).toBe('malformed')
    expect(await authoritativeState('3001')).toEqual(before)
  })

  it('SUBMIT_ANSWERS 不许从电线上进来', async () => {
    const duel = await openDuel('3002')
    const before = await authoritativeState('3002')

    // 这条指令直接决定谁答对、谁得分，客户端能发就等于能宣布自己全对。
    duel.sides[0].client.sendRaw(
      JSON.stringify({
        type: 'match:command',
        command: {
          type: 'SUBMIT_ANSWERS',
          results: [
            { instanceId: 'p0-c0', correct: true, answer: '对', reasoning: '因为我说了算' },
          ],
        },
      }),
    )
    expect((await duel.sides[0].client.expect('room:error')).reason).toBe('malformed')
    expect(await authoritativeState('3002')).toEqual(before)
  })

  it('多塞一个字段的指令整条被拒（上行是严格解析）', async () => {
    const duel = await openDuel('3003')
    const before = await authoritativeState('3003')
    duel.sides[0].client.sendRaw(
      JSON.stringify({
        type: 'match:command',
        command: { type: 'END_PLAY', player: 0, extra: '偷偷夹带' },
      }),
    )
    expect((await duel.sides[0].client.expect('room:error')).reason).toBe('malformed')
    expect(await authoritativeState('3003')).toEqual(before)
  })

  it('指向不存在的牌只回执给发指令方，不进广播', async () => {
    const duel = await openDuel('3004')
    const before = await authoritativeState('3004')
    const seat = duel.sides[0].view.activePlayer
    const attacker = duel.sides[seat]

    attacker.client.send({
      type: 'match:command',
      command: { type: 'PLAY_CARD', player: seat, instanceId: '根本不存在的牌' },
    })
    // COMMAND_REJECTED 不进事件批（filterEvent 一律返回 null），单独回给发指令那一方。
    const rejected = await attacker.client.expect('match:rejected')
    expect(rejected.reason.length).toBeGreaterThan(0)
    expect(await authoritativeState('3004')).toEqual(before)
    expect(duel.sides[seat === 0 ? 1 : 0].client.pending()).toBe(0)
  })

  it('掉线之后拿别人的 token 冒充不进来，本人重连还是原座位', async () => {
    const duel = await openDuel('3005')
    duel.sides[0].client.close()
    expect((await duel.sides[1].client.until('room:peer')).online).toBe(false)

    // 外人拿自己的 token 想补上空出来的座位。
    const carol = await Client.connect('3005', await tokenFor('carol'))
    expect((await carol.expect('session:rejected')).reason).toBe('room-full')
    expect((await carol.waitClosed()).code).toBe(CLOSE_ROOM_FULL)

    // 房里的另一个人也抢不到空座位：座位是建房时按账号定死的。
    const bobAgain = await Client.connect('3005', await tokenFor('bob'))
    bobAgain.send(HELLO)
    expect((await bobAgain.expect('session:welcome')).place).toEqual({
      kind: 'room',
      code: '3005',
      seat: 1,
    })
    // 顺带验一下顶号：bob 的旧连接被这条新的顶掉了。
    expect((await duel.sides[1].client.waitClosed()).code).toBe(CLOSE_SUPERSEDED)
    bobAgain.close()
  })

  it('不合法的牌组开不了局', async () => {
    await setupRoom('3006', ['alice', 'bob'])
    const alice = await Client.connect('3006', await tokenFor('alice'))
    alice.send(HELLO)
    await alice.expect('session:welcome')
    await alice.expect('room:peer')

    // 张数不对。
    alice.send({ type: 'room:loadout', deck: ['gpt-4o'], hero: null })
    expect((await alice.expect('room:error')).reason).toBe('bad-loadout')

    // 同名超过 3 张。
    alice.send({ type: 'room:loadout', deck: Array(20).fill('gpt-4o'), hero: null })
    expect((await alice.expect('room:error')).reason).toBe('bad-loadout')

    // 不在卡池里的牌（gpt-2 调不到模型，进不了卡池）。
    const smuggled = ['gpt-2', ...Array(19).fill('gpt-4o').slice(0, 19)]
    alice.send({ type: 'room:loadout', deck: smuggled, hero: null })
    expect((await alice.expect('room:error')).reason).toBe('bad-loadout')

    // 技能还没实装的英雄（选英雄界面本来就该置灰），带上来一样不收。
    alice.send({ type: 'room:loadout', deck: [...BALANCED_DECK], hero: 'fei-fei-li' })
    expect((await alice.expect('room:error')).reason).toBe('bad-loadout')
    alice.close()
  })

  it('没装载就就绪、重复装载都被拦下', async () => {
    const duel = await openDuel('3007')
    // 开局之后再装载一次。
    duel.sides[0].client.send({ type: 'room:loadout', deck: Array(20).fill('gpt-4o'), hero: null })
    expect((await duel.sides[0].client.expect('room:error')).reason).toBe('already-loaded')
    duel.sides[0].client.send({ type: 'room:ready' })
    expect((await duel.sides[0].client.expect('room:error')).reason).toBe('already-ready')
  })

  it('对局还没开始就发指令，回 not-in-match', async () => {
    await setupRoom('3008', ['alice', 'bob'])
    const alice = await Client.connect('3008', await tokenFor('alice'))
    alice.send(HELLO)
    await alice.expect('session:welcome')
    await alice.expect('room:peer')

    alice.send({ type: 'match:command', command: { type: 'END_PLAY', player: 0 } })
    expect((await alice.expect('room:error')).reason).toBe('not-in-match')
    alice.send({ type: 'room:resync', haveSeq: 0 })
    expect((await alice.expect('room:error')).reason).toBe('not-in-match')
    alice.close()
  })
})
