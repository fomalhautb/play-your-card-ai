/**
 * 答题 autopilot 和空房超时，两件事共用房间对象那**一个** alarm（迁移第 23 条）。
 *
 * 断言的对象仍然是电线上真的出现过的消息：`SUBMIT_ANSWERS` 是服务端自己发的，
 * 客户端看得到的只有它产生的那批事件。
 * 时间不真等——`runDurableObjectAlarm` 把 alarm 立刻叫醒，
 * 排在十分钟后的空房检查则先把到点时刻改到过去（见 helpers.ts 的两个工具）。
 */

import { CLOSE_ROOM_NOT_FOUND } from '@ai-duel/protocol'
import { describe, expect, it } from 'vitest'
import { openDuel, playUntilQuiz } from './duel'
import {
  authoritativeState,
  Client,
  expireAlarm,
  fireRoomAlarm,
  HELLO,
  setupRoom,
  signToken,
  waitRoomEmpty,
} from './helpers'

describe('答题 alarm', () => {
  it('题目揭晓之后 alarm 到点，服务端自己把这一轮答完', async () => {
    const duel = await openDuel('4000')
    await playUntilQuiz(duel)
    // 走到这儿双方都收完了带 QUESTION_REVEALED 的那批事件，谁也没再收到东西。
    for (const side of duel.sides) expect(side.client.pending()).toBe(0)
    expect(await fireRoomAlarm('4000')).toBe(true)

    for (const side of duel.sides) {
      const batch = await side.client.expect('match:events')
      const types = batch.events.map((event) => event.type)
      expect(types).toContain('AI_ANSWERED')
      expect(types).toContain('ROUND_SCORED')
    }
    // 权威局面也真的往前走了，不是只发了几条事件。
    expect((await authoritativeState('4000')).phase).toBe('settle')
  })

  it('题面公开、答案还遮着：下发的事件里一个答案都没有', async () => {
    const duel = await openDuel('4001')
    await playUntilQuiz(duel)
    for (const side of duel.sides) {
      const revealed = side.events.filter((event) => event.type === 'QUESTION_REVEALED')
      expect(revealed.length).toBeGreaterThan(0)
      for (const event of revealed) {
        // filterEvent 把整道题换成了 PublicQuestion：有题面，没有答案和解析。
        expect('text' in event.question).toBe(true)
        expect('answer' in event.question).toBe(false)
      }
      // 视图里当前这道题同样停在「题面公开」这一档，结算之后才是 'answer'。
      expect(side.view.questions[side.view.round - 1]?.reveal).toBe('text')
    }
    // 服务端手上那份是带答案的整道题——被裁掉的东西确实存在，只是没上电线。
    const state = await authoritativeState('4001')
    expect(state.questions[state.round - 1]?.answer).toBeDefined()
  })

  it('alarm 到点时已经不在答题阶段，什么都不发', async () => {
    const duel = await openDuel('4002')
    // 出牌阶段，本来没有答题定时器；把它排到过去，模拟「定时器还在但局面已经走开了」。
    await expireAlarm('4002', 'quiz')
    expect(await fireRoomAlarm('4002')).toBe(true)

    const before = await authoritativeState('4002')
    // 再发一条合法指令，双方各收到的仍然是这一条的回应——中间没夹进任何答题事件。
    const seat = duel.sides[0].view.activePlayer
    duel.sides[seat].client.send({
      type: 'match:command',
      command: { type: 'END_PLAY', player: seat },
    })
    for (const side of duel.sides) {
      const batch = await side.client.expect('match:events')
      expect(batch.events.some((event) => event.type === 'AI_ANSWERED')).toBe(false)
    }
    expect(before.phase).toBe('play')
  })

  it('房间收摊之后 alarm 被撤掉，再也不会响', async () => {
    const duel = await openDuel('4003')
    await playUntilQuiz(duel)
    // 这时答题 alarm 已经排上了，但有人不打了。
    duel.sides[0].client.send({ type: 'room:leave' })
    for (const side of duel.sides) {
      expect((await side.client.until('room:closed')).reason).toBe('peer-left')
    }
    expect(await fireRoomAlarm('4003')).toBe(false)
  })
})

describe('空房超时', () => {
  it('建好的房一直没人来，到点自己关掉', async () => {
    await setupRoom('4010', ['alice', 'bob'])
    await expireAlarm('4010', 'idle')
    expect(await fireRoomAlarm('4010')).toBe(true)
    // 收摊时两种定时任务一起撤掉，对象不会再被叫醒。
    expect(await fireRoomAlarm('4010')).toBe(false)

    // 关了的房间谁都进不去，和「房间不存在」是同一条路。
    const late = await Client.connect('4010', await signToken('alice'))
    const rejected = await late.expect('session:rejected')
    expect(rejected.reason).toBe('room-not-found')
    expect((await late.waitClosed()).code).toBe(CLOSE_ROOM_NOT_FOUND)
  })

  it('房里有人连着就不算空房，检查完再续一轮', async () => {
    await setupRoom('4011', ['alice', 'bob'])
    const alice = await Client.connect('4011', await signToken('alice'))
    alice.send(HELLO)
    await alice.expect('session:welcome')
    await alice.expect('room:peer')

    await expireAlarm('4011', 'idle')
    expect(await fireRoomAlarm('4011')).toBe(true)
    // 没收到 room:closed，连接也还开着。
    expect(alice.pending()).toBe(0)
    // 而且下一轮检查已经排上了：alarm 还在。
    expect(await fireRoomAlarm('4011')).toBe(true)
    alice.close()
  })

  it('打到一半双方都掉线，到点一样收摊', async () => {
    const duel = await openDuel('4012')
    for (const side of duel.sides) side.client.close()
    await waitRoomEmpty('4012')

    await expireAlarm('4012', 'idle')
    expect(await fireRoomAlarm('4012')).toBe(true)
    expect(await fireRoomAlarm('4012')).toBe(false)

    // 重连也进不来了：收摊过的房间和不存在的房间对客户端是同一回事。
    const back = await Client.connect('4012', await signToken('alice'))
    expect((await back.expect('session:rejected')).reason).toBe('room-not-found')
  })
})
