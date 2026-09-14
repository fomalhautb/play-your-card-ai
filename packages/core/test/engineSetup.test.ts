/**
 * 开局：`createGame` 的单元测试（对应 src/engineSetup.ts）。
 *
 * 抛硬币定先手、各发起始手牌、洗牌和洗题序，外加排剧本要用的两个覆盖项
 *（指定先手、noShuffle）。
 *
 * 开局那串事件末尾的 ROUND_STARTED / PLAY_TURN_STARTED 是 engineRound.ts 的 announceRound 发的，
 * 每轮换手时发的是同一串，那半边归 engineRound.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { QUESTION_POOL } from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import type { CardId } from '../src/index'
import { STARTING_HAND_SIZE } from '../src/index'
import { deckOf, newGame, SEED_FIRST_0, SEED_FIRST_1 } from './helpers/engineFixtures'

describe('开局', () => {
  it('抛硬币定先手、各发 5 张、宣告第 1 轮', () => {
    const { state, events } = newGame()

    expect(state.phase).toBe('play')
    expect(state.round).toBe(1)
    expect(state.totalRounds).toBe(QUESTION_POOL.length)
    expect(state.firstPlayer).toBe(0)
    expect(state.activePlayer).toBe(state.firstPlayer)
    expect(state.winner).toBeNull()
    expect(state.players.map((p) => p.hand.length)).toEqual([
      STARTING_HAND_SIZE,
      STARTING_HAND_SIZE,
    ])
    expect(state.players.map((p) => p.score)).toEqual([0, 0])

    expect(events.map((e) => e.type)).toEqual([
      'GAME_STARTED',
      ...Array.from({ length: STARTING_HAND_SIZE * 2 }, () => 'CARD_DRAWN'),
      'ROUND_STARTED',
      'PLAY_TURN_STARTED',
    ])
    expect(events[0]).toEqual({ type: 'GAME_STARTED', firstPlayer: 0 })
    expect(events.at(-2)).toEqual({
      type: 'ROUND_STARTED',
      round: 1,
      firstPlayer: 0,
      category: state.questions[0]!.category,
      // 关键词和类别一样，出牌阶段就公开：玩家要靠它决定派谁上场。
      keywords: state.questions[0]!.keywords,
    })
    expect(events.at(-1)).toEqual({ type: 'PLAY_TURN_STARTED', player: 0 })
  })

  it('ROUND_STARTED 带的关键词是题目自己那一份的拷贝，改事件改不到题库', () => {
    const { state, events } = newGame()
    const started = events.find((e) => e.type === 'ROUND_STARTED')!
    expect(started.keywords).toEqual(state.questions[0]!.keywords)
    expect(started.keywords).not.toBe(state.questions[0]!.keywords)
  })

  it('同一个种子洗出同一副牌堆、同一份题序、同一个先手', () => {
    const a = newGame().state
    const b = newGame().state
    expect(a.firstPlayer).toBe(b.firstPlayer)
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id))
    expect(a.players[0].deck.map((c) => c.cardId)).toEqual(b.players[0].deck.map((c) => c.cardId))
    expect(a.players[1].deck.map((c) => c.cardId)).toEqual(b.players[1].deck.map((c) => c.cardId))
  })

  it('换个种子能掷出另一个先手', () => {
    expect(newGame({ seed: SEED_FIRST_0 }).state.firstPlayer).toBe(0)
    expect(newGame({ seed: SEED_FIRST_1 }).state.firstPlayer).toBe(1)
  })

  it('题序用光整个题库且不重复', () => {
    const { state } = newGame()
    const ids = state.questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(QUESTION_POOL.map((q) => q.id)))
  })
})

describe('开局的两个覆盖项（排剧本要用）', () => {
  it('指定先手就不掷硬币，GAME_STARTED 照常带 firstPlayer', () => {
    for (const seat of [0, 1] as const) {
      const { state, events } = newGame({ firstPlayer: seat })
      expect(state.firstPlayer).toBe(seat)
      expect(state.activePlayer).toBe(seat)
      expect(events[0]).toEqual({ type: 'GAME_STARTED', firstPlayer: seat })
    }
  })

  it('指定先手不消耗随机数：换个先手不会连带把牌堆和题序也洗成另一副', () => {
    // 抛硬币是整个跳过的（不是掷完丢掉），所以这一掷不再推进 rng：
    // 同一个种子下改先手，后面洗出来的牌堆和题序一字不差。
    // 排剧本时才能"先定牌序，再单独安排谁先手"，两件事互不牵连。
    const zero = newGame({ firstPlayer: 0 }).state
    const one = newGame({ firstPlayer: 1 }).state
    expect([zero.firstPlayer, one.firstPlayer]).toEqual([0, 1])
    expect(one.questions.map((q) => q.id)).toEqual(zero.questions.map((q) => q.id))
    for (const seat of [0, 1] as const) {
      expect(one.players[seat].deck.map((c) => c.cardId)).toEqual(
        zero.players[seat].deck.map((c) => c.cardId),
      )
    }
  })

  it('noShuffle 时牌组和题库都按传入顺序原样使用，抽牌从末尾取', () => {
    // 牌堆顶在数组末尾，所以起手 5 张就是牌组倒过来的最后 5 张。
    const deck: CardId[] = [
      ...deckOf('gpt-2', 5),
      'chatgpt-5-6-sol',
      'claude-5-sonnet',
      'deepseek-r1',
      'gpt-3-5',
      'gpt-4o',
    ]
    const { state } = newGame({ deck0: deck, deck1: deck, noShuffle: true })
    expect(state.players[0].hand.map((c) => c.cardId)).toEqual([
      'gpt-4o',
      'gpt-3-5',
      'deepseek-r1',
      'claude-5-sonnet',
      'chatgpt-5-6-sol',
    ])
    // 剩下的牌堆保持原序，末尾仍然是下一张要抽的。
    expect(state.players[0].deck.map((c) => c.cardId)).toEqual(deckOf('gpt-2', 5))
    // 题库按原序逐轮取，questions[0] 就是题库第一道。
    expect(state.questions.map((q) => q.id)).toEqual(QUESTION_POOL.map((q) => q.id))
  })

  it('noShuffle 下换种子也是同一副牌：随机彻底不参与', () => {
    const a = newGame({ noShuffle: true, firstPlayer: 0, seed: 1 }).state
    const b = newGame({ noShuffle: true, firstPlayer: 0, seed: 12345 }).state
    expect(a.players[0].hand.map((c) => c.cardId)).toEqual(b.players[0].hand.map((c) => c.cardId))
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id))
  })
})
