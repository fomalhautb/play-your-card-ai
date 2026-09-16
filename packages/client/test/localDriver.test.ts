/**
 * 单机 driver：视图裁剪、快照、事件批、两种座位口径，以及调试指令那条独立的口子。
 *
 * 裁剪那几条是这份测试最要紧的部分：本地明明有整份 `GameState`，却仍然只给场景
 * `viewFor` 的产物——少了这一道，单机能画出联机根本拿不到的信息，
 * 而那种偏差要等接上联机才发作（见 src/match/localDriver.ts 的文件头）。
 */

import { other } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import type { MatchEventBatch } from '../src/match/driver'
import { createLocalDriver, isLocalDriver } from '../src/match/localDriver'
import { createFakeClock, localSetup } from './helpers/localGame'

/** 开一局，顺手把事件批收进一个数组。 */
function open(seat: 0 | 1 | 'active' = 0) {
  const timers = createFakeClock()
  const driver = createLocalDriver({ seat, setup: localSetup(), timers })
  const batches: MatchEventBatch[] = []
  driver.subscribeEvents((batch) => batches.push(batch))
  return { driver, timers, batches }
}

describe('开局', () => {
  it('第一份快照就带着裁剪视图和座位', () => {
    const { driver } = open()
    const snapshot = driver.getSnapshot()
    expect(snapshot.seat).toBe(0)
    expect(snapshot.status).toBe('playing')
    expect(snapshot.view?.viewer).toBe(0)
    // 单机没有连接可断，也没有房间。
    expect(snapshot.link).toBe('ok')
    expect(snapshot.peer).toBe(null)
  })

  it('开局那批事件补发给第一个订阅者', () => {
    const { batches } = open()
    expect(batches).toHaveLength(1)
    expect(batches[0]?.events.map((event) => event.type)).toContain('GAME_STARTED')
    // 事件批带的视图就是这一批之后的局面，演出层拿它对账。
    expect(batches[0]?.view.round).toBe(1)
  })

  it('视图是裁剪过的：对手手牌只有张数，题目只有关键词', () => {
    const { driver } = open()
    const view = driver.getSnapshot().view
    expect(view?.opponent.handCount).toBeGreaterThan(0)
    // 出牌阶段只公开类别和关键词，题面要等 QUESTION_REVEALED（见 core 的 QuestionView）。
    expect(view?.questions[0]?.reveal).toBe('keywords')
    expect(view?.self.hand.length).toBeGreaterThan(0)
  })

  it('事件也裁剪过：对手摸的牌只剩「他多了一张」', () => {
    const { batches } = open()
    const drawn = batches[0]?.events.filter((event) => event.type === 'CARD_DRAWN') ?? []
    const foeDraws = drawn.filter((event) => event.player === 1)
    expect(foeDraws.length).toBeGreaterThan(0)
    expect(foeDraws.every((event) => event.card === undefined)).toBe(true)
  })
})

describe('发指令', () => {
  it('打出一张手牌之后局面和事件都跟着走', () => {
    const { driver, batches } = open()
    const view = driver.getSnapshot().view
    expect(view?.activePlayer).toBe(0)
    const hand = view?.self.hand ?? []
    const before = hand.length
    /*
     * 挑一张打得起的 AI 牌，别拿手上第一张顶：技能牌多半要指定目标，
     * 不带目标发过去会被引擎整条拒掉，那这一条测的就变成「拒绝」而不是「出牌」了。
     */
    const playable = hand.find((one) => {
      const card = view?.catalog.cards[one.cardId]
      return card?.kind === 'ai' && card.tokenCost <= (view?.self.tokens ?? 0)
    })
    expect(playable).toBeDefined()
    driver.send({ type: 'PLAY_CARD', player: 0, instanceId: playable!.instanceId })
    expect(driver.getSnapshot().lastRejection).toBe(null)
    expect(driver.getSnapshot().view?.self.hand).toHaveLength(before - 1)
    expect(batches).toHaveLength(2)
    // 新视图和快照是同一份对象：演出层和界面看到的必须是同一个局面。
    expect(batches[1]?.view).toBe(driver.getSnapshot().view)
  })

  it('被拒的指令进 lastRejection，下一批清掉', () => {
    const { driver } = open()
    // 现在轮到 0 号出牌，1 号发 END_PLAY 会被引擎拒。
    driver.send({ type: 'END_PLAY', player: 1 })
    expect(driver.getSnapshot().lastRejection).not.toBe(null)
    driver.send({ type: 'END_PLAY', player: 0 })
    expect(driver.getSnapshot().lastRejection).toBe(null)
  })

  it('被拒那条事件照样发给演出层，不然它会一直等着回包', () => {
    const { driver, batches } = open()
    const before = batches.length
    driver.send({ type: 'END_PLAY', player: 1 })
    /*
     * `filterEvent` 对 `COMMAND_REJECTED` 一律返回 null（它不进广播，见 core 的 view.ts），
     * 而空批不发（见 driverCore 的 emitBatch）。两条撞在一起的后果是演出编排层永远等不到
     * 「上一条指令有结果了」：`awaiting` 一直挂着、手牌一直锁着，**一次被拒之后整局都出不了牌**。
     * 所以这一条要原样留给发起方——服务端也是单独回给发指令那条连接的。
     */
    expect(batches).toHaveLength(before + 1)
    expect(batches.at(-1)?.events.map((event) => event.type)).toEqual(['COMMAND_REJECTED'])
  })

  it('dispose 之后指令不再进引擎', () => {
    const { driver } = open()
    const before = driver.getSnapshot().view
    driver.dispose()
    driver.send({ type: 'END_PLAY', player: 0 })
    expect(driver.getSnapshot().view).toBe(before)
  })
})

describe('两种座位口径', () => {
  it('测试房固定 0 号座，换手也不动', () => {
    const { driver } = open(0)
    driver.send({ type: 'END_PLAY', player: 0 })
    expect(driver.getSnapshot().seat).toBe(0)
    expect(driver.getSnapshot().view?.viewer).toBe(0)
  })

  it('热座跟着行动方翻面', () => {
    const { driver } = open('active')
    expect(driver.getSnapshot().seat).toBe(0)
    driver.send({ type: 'END_PLAY', player: 0 })
    const after = driver.getSnapshot()
    expect(after.seat).toBe(1)
    // 视图整个翻过来：刚才的「对手」现在是「我方」。
    expect(after.view?.viewer).toBe(1)
    expect(after.view?.self.id).toBe(1)
  })

  it('热座下事件也按新视角裁剪', () => {
    const { driver, batches } = open('active')
    driver.send({ type: 'END_PLAY', player: 0 })
    const last = batches.at(-1)
    expect(last?.view.viewer).toBe(1)
  })
})

describe('调试指令', () => {
  it('走 debug 那条口子，不走 send', () => {
    const { driver } = open()
    const before = driver.getSnapshot().view?.self.hand.length ?? 0
    driver.debug({ type: 'DEBUG_ADD_CARD', player: 0 })
    expect(driver.getSnapshot().view?.self.hand).toHaveLength(before + 1)
  })

  it('跳到答题：DEBUG_SKIP_TO_QUIZ 直接推进阶段', () => {
    const { driver } = open()
    driver.debug({ type: 'DEBUG_SKIP_TO_QUIZ' })
    expect(driver.getSnapshot().view?.phase).toBe('quiz')
  })

  it('peek 给的是未裁剪的完整局面', () => {
    const { driver } = open()
    const state = driver.peek()
    // 裁剪视图里对手的手牌连实例 id 都没有，而这里能看到整只手。
    expect(state.players[other(0)].hand.length).toBeGreaterThan(0)
    expect(state.rngSeed).toBeTypeOf('number')
  })

  it('isLocalDriver 认得出自己', () => {
    const { driver } = open()
    expect(isLocalDriver(driver)).toBe(true)
    // 联机 driver 上没有这两个方法，随手编一个不带它们的对象就该被判否。
    expect(isLocalDriver({ send: () => undefined } as never)).toBe(false)
  })
})
