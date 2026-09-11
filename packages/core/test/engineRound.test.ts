/**
 * 回合确认与本轮计分的账：双方点过确认之后局面怎么推进
 *（对应 src/engineRound.ts 的 confirmRound）。
 *
 * 「回合计分」这一节看的是 ROUND_SCORED 里 `spent` 那个数对不对、以及它每轮清零，
 * 也就是跨过"进下一轮"这一步才验得了的那一半，所以和确认放在一起。
 * 分本身怎么判（三档 verdict）在 engineQuiz.test.ts，收场判定在 engineRoundEnding.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import type { CardId } from '../src/index'
import { execute, INITIAL_TOKEN_MAX, ROUND_DRAW_SIZE, TOKEN_MAX_GROWTH } from '../src/index'
import {
  answersFor,
  confirmBoth,
  deckOf,
  deploy,
  handCard,
  newGame,
  run,
  toQuiz,
} from './helpers/engineFixtures'

describe('回合确认', () => {
  /** 摆一个刚算完分、停在结算阶段的局面（双方各一个 AI，两条判据都平）。 */
  function settlePhase() {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('gpt-3-5') })
    const quiz = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(game.state, 0, 'gpt-3-5').instanceId },
      { type: 'END_PLAY', player: 0 },
    ]).state
    const both = run(quiz, [
      { type: 'PLAY_CARD', player: 1, instanceId: handCard(quiz, 1, 'gpt-3-5').instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
    return execute(both, { type: 'SUBMIT_ANSWERS', results: answersFor(both) }).state
  }

  it('只有一方确认时局面不动，只发一条 ROUND_CONFIRMED', () => {
    const settle = settlePhase()
    const result = execute(settle, { type: 'CONFIRM_ROUND', player: 0 })

    expect(result.events).toEqual([{ type: 'ROUND_CONFIRMED', player: 0 }])
    expect(result.state.settleConfirmed).toEqual([true, false])
    expect(result.state.phase).toBe('settle')
    expect(result.state.round).toBe(1)
    expect(result.state.players[0].hand.length).toBe(settle.players[0].hand.length)
  })

  it('同一方确认两次时第二次被拒', () => {
    const once = execute(settlePhase(), { type: 'CONFIRM_ROUND', player: 0 }).state
    const result = execute(once, { type: 'CONFIRM_ROUND', player: 0 })

    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '这一轮你已经确认过了' }])
    expect(result.state).toBe(once)
  })

  it('不在结算阶段确认会被拒', () => {
    const game = newGame()
    const play = execute(game.state, { type: 'CONFIRM_ROUND', player: 0 })
    expect(play.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是回合结算阶段' }])
    expect(play.state).toBe(game.state)

    const quiz = toQuiz(game.state)
    expect(execute(quiz, { type: 'CONFIRM_ROUND', player: 1 }).events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '现在不是回合结算阶段' },
    ])
  })

  it('双方都确认后才推进：轮次 +1、额度补满并涨上限、本轮消耗清零、双方补牌', () => {
    const settle = settlePhase()
    expect(settle.players.map((p) => p.spentThisRound)).toEqual([2, 2])
    const handsBefore = settle.players.map((p) => p.hand.length)
    const result = confirmBoth(settle)

    expect(result.state.phase).toBe('play')
    expect(result.state.round).toBe(2)
    expect(result.state.settleConfirmed).toEqual([true, true])
    for (const player of result.state.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
      expect(player.tokens).toBe(player.tokenMax)
      expect(player.spentThisRound).toBe(0)
    }
    expect(result.state.players.map((p) => p.hand.length)).toEqual(
      handsBefore.map((n) => n + ROUND_DRAW_SIZE),
    )
    // 两条确认各自留下一条事件，推进产生的那批全部跟在第二条后面。
    expect(result.events.slice(0, 2)).toEqual([
      { type: 'ROUND_CONFIRMED', player: 0 },
      { type: 'ROUND_CONFIRMED', player: 1 },
    ])
  })
})

describe('回合计分', () => {
  /**
   * 摆一个算完分的局面：双方各按给定的卡摆场，全部答对。
   *
   * 列表里 AI 牌和技能牌都不限张数，正好用来测"技能牌也计入本轮消耗"。
   * 双方都不带英雄：默认英雄会抵消对方第一张技能牌，那样测的就不是消耗口径了。
   */
  function scoreWith(cards0: CardId[], cards1: CardId[]) {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    const both = deploy(deploy(game.state, 0, cards0), 1, cards1)
    const quiz = execute(both, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    return execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
  }

  function scoredEvent(result: ReturnType<typeof scoreWith>) {
    return result.events.find((e) => e.type === 'ROUND_SCORED')
  }

  it('spent 就是本轮打出的牌的费用和，技能牌也算在内', () => {
    // 「一句话回答」1 点：它不上场，所以不影响"这一方答没答对"，但照样计入消耗，
    // 于是甲多花了这 1 点，答对数量相同时的第二判据就倒向乙。
    const result = scoreWith(['gpt-2', 'one-sentence-answer'], ['gpt-2'])
    expect(scoredEvent(result)).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 1],
      scores: [0, 1],
      correctCounts: [1, 1],
      spent: [2, 1],
      verdict: 'fewer-tokens',
    })
  })

  it('进下一轮后本轮消耗清零，上一轮的花费不会带过来', () => {
    const settle = scoreWith(['gpt-2'], ['gpt-3-5']).state
    expect(settle.players.map((p) => p.spentThisRound)).toEqual([1, 2])

    const round2 = confirmBoth(settle).state
    expect(round2.players.map((p) => p.spentThisRound)).toEqual([0, 0])

    // 第 2 轮甲什么都不打、乙打一张技能牌：双方答对数仍是 1:1，才能落到消耗判据。
    // 上一轮的消耗要是带过来了，判据就不会倒向甲。
    const deployed = deploy(round2, 1, ['one-sentence-answer'])
    const quiz = execute(deployed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scoredEvent(scored)).toMatchObject({
      correctCounts: [1, 1],
      spent: [0, 1],
      gains: [1, 0],
      verdict: 'fewer-tokens',
    })
  })
})
