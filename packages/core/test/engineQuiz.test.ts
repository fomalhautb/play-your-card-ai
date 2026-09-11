/**
 * 答题结算：判对错、罚下答错的、算出这一轮谁拿分（对应 src/engineQuiz.ts 的 submitAnswers）。
 *
 * 边界和引擎那边一样在「算完分就收手」：这一份只看到 settle 阶段为止。
 * 双方确认之后的推进（补牌、换先手、清标记）和终局判定在 engineRound.test.ts /
 * engineRoundEnding.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import type { CardId } from '../src/index'
import { execute, ROUND_DRAW_SIZE } from '../src/index'
import {
  answersFor,
  board,
  confirmBoth,
  deckOf,
  handCard,
  newGame,
  nextRound,
  run,
  scoredOf,
  toQuiz,
} from './helpers/engineFixtures'

describe('答题结算', () => {
  /**
   * 摆一个答题阶段：双方各派一张 AI，然后都结束出牌。
   *
   * 用不洗牌的单卡牌组，本轮消耗就正好等于那张 AI 的费用，Token 决胜那几条好对账。
   */
  function duel(card0: CardId, card1: CardId) {
    const game = newGame({ deck0: deckOf(card0), deck1: deckOf(card1), noShuffle: true })
    return run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: game.state.players[0].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: game.state.players[1].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
  }

  /**
   * 摆一个"甲两个 AI、乙一个 AI"的答题阶段局面，停在第 2 轮。
   *
   * 甲那两个分两轮上场，这个局面天然是跨轮的：
   * 第 1 轮甲派 GPT-3.5（2 点）、乙派 Claude 5 Sonnet（4 点），双方都答对，
   * 消耗少的甲拿下第 1 分（比分 1:0）；第 2 轮甲再派一张 GPT-3.5（2 点），乙不出牌（0 点）。
   * 所以进第 2 轮答题时：场上 2 对 1，本轮消耗 2 对 0，比分 1:0——下面的用例都从这个基准往下算。
   */
  function twoVsOne() {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('claude-5-sonnet') })
    const quizR1 = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: game.state.players[0].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'PLAY_CARD', player: 1, instanceId: game.state.players[1].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 1 },
    ]).state
    const settledR1 = execute(quizR1, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quizR1),
    }).state
    // 第 2 轮换乙先手：乙直接过，甲再派一张，然后进答题。
    const round2 = confirmBoth(settledR1).state
    return run(round2, [
      { type: 'END_PLAY', player: 1 },
      { type: 'PLAY_CARD', player: 0, instanceId: handCard(round2, 0, 'gpt-3-5').instanceId },
      { type: 'END_PLAY', player: 0 },
    ]).state
  }

  it('答错的罚下进弃牌堆，答对的留场，最后停在结算阶段', () => {
    const quiz = twoVsOne()
    const [survivor, doomed] = board(quiz, 0)
    const theirs = board(quiz, 1)[0]!
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [doomed!.instanceId]),
    })

    expect(board(result.state, 0).map((a) => a.instanceId)).toEqual([survivor!.instanceId])
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([doomed!.instanceId])
    expect(board(result.state, 1).map((a) => a.instanceId)).toEqual([theirs.instanceId])
    // 双方各答对一个，数量相同才改比本轮消耗：甲花了 2 点、乙一点没花，
    // 这一分归乙，比分从 1:0 变成 1:1。
    expect(result.state.players.map((p) => p.score)).toEqual([1, 1])

    // 事件序：逐个揭晓回答，答错的紧跟一条罚下，最后统一计分。
    expect(result.events).toEqual([
      {
        type: 'AI_ANSWERED',
        instanceId: survivor!.instanceId,
        owner: 0,
        cardId: 'gpt-3-5',
        correct: true,
        answer: '占位',
        reasoning: '占位理由',
      },
      {
        type: 'AI_ANSWERED',
        instanceId: doomed!.instanceId,
        owner: 0,
        cardId: 'gpt-3-5',
        correct: false,
        answer: '占位',
        reasoning: '占位理由',
      },
      { type: 'AI_ELIMINATED', instanceId: doomed!.instanceId, owner: 0 },
      {
        type: 'AI_ANSWERED',
        instanceId: theirs.instanceId,
        owner: 1,
        cardId: 'claude-5-sonnet',
        correct: true,
        answer: '占位',
        reasoning: '占位理由',
      },
      {
        type: 'ROUND_SCORED',
        gains: [0, 1],
        scores: [1, 1],
        correctCounts: [1, 1],
        spent: [2, 0],
        verdict: 'fewer-tokens',
      },
    ])

    // 计分完就停下等确认：这一批里没有下一轮的任何动静。
    expect(result.state.phase).toBe('settle')
    expect(result.state.settleConfirmed).toEqual([false, false])
    expect(result.state.round).toBe(2)
    expect(result.state.firstPlayer).toBe(1)
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'CARD_DRAWN')).toBe(false)
  })

  it('答对数量更多时那方 +1，消耗一样多也不改判', () => {
    // 双方都花 2 点，但甲答对数更多——more-correct 排在比 Token 之前。
    const quiz = duel('gpt-3-5', 'gpt-3-5')
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [board(quiz, 1)[0]!.instanceId]),
    })
    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correctCounts: [1, 0],
      spent: [2, 2],
      verdict: 'more-correct',
    })
  })

  it('逐个统计答对数量，答错的 AI 仍照常罚下', () => {
    // 两个 AI 分两轮派，测的是跨轮留场的 AI 也计入本轮答对数量。
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), noShuffle: true })
    const first = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const round2 = nextRound(first)
    const both = execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(round2, 0, 'gpt-2').instanceId,
    }).state
    expect(board(both, 0)).toHaveLength(2)

    const quiz = toQuiz(both)
    const doomed = board(quiz, 0)[1]!
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [doomed.instanceId]),
    })

    // 一个答对、一个答错：答对数记 1，答错的那个照常罚下。
    expect(board(result.state, 0)).toHaveLength(1)
    expect(scoredOf(result.events)!.correctCounts).toEqual([1, 0])
    expect(scoredOf(result.events)!.gains).toEqual([1, 0])
  })

  it('双方答对数量相同时比本轮消耗，少的一方 +1', () => {
    // 甲的 GPT-2 花 1 点，乙的 GPT-4o 花 4 点。
    const quiz = duel('gpt-2', 'gpt-4o')
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correctCounts: [1, 1],
      spent: [1, 4],
      verdict: 'fewer-tokens',
    })
    // 都答对，谁都没被罚下。
    expect([board(result.state, 0).length, board(result.state, 1).length]).toEqual([1, 1])
  })

  it('双方答对数量都是零时同样比本轮消耗，少的一方 +1', () => {
    const quiz = duel('gpt-4o', 'gpt-2')
    const result = execute(quiz, {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(quiz, [board(quiz, 0)[0]!.instanceId, board(quiz, 1)[0]!.instanceId]),
    })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [0, 1],
      scores: [0, 1],
      correctCounts: [0, 0],
      spent: [4, 1],
      verdict: 'fewer-tokens',
    })
    // 两个都答错、两个都被罚下，场面清空。
    expect([board(result.state, 0).length, board(result.state, 1).length]).toEqual([0, 0])
  })

  it('结果相同且消耗也相同时双方各 +1', () => {
    const quiz = duel('gpt-3-5', 'gpt-3-5')
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 1],
      scores: [1, 1],
      correctCounts: [1, 1],
      spent: [2, 2],
      verdict: 'equal-tokens',
    })
  })

  it('场上没有 AI 的一方算没答对', () => {
    // 甲派一张答对，乙一张都没派：乙一条 AI_ANSWERED 都没有，判定里仍然是"没答对"。
    const game = newGame({ deck0: deckOf('gpt-2'), noShuffle: true })
    const quiz = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: game.state.players[0].hand[0]!.instanceId },
      { type: 'END_PLAY', player: 0 },
      { type: 'END_PLAY', player: 1 },
    ]).state
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [1, 0],
      correctCounts: [1, 0],
      spent: [1, 0],
      verdict: 'more-correct',
    })
  })

  it('双方场上都没有 AI 时提交空结果：同错同消耗，各 +1，对局继续', () => {
    // 两边都没答对、都没花钱，按规则就是 equal-tokens 各 +1，而不是各 0 分。
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] })

    expect(scoredOf(result.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 1],
      scores: [1, 1],
      correctCounts: [0, 0],
      spent: [0, 0],
      verdict: 'equal-tokens',
    })
    // 计分完停在 settle，双方确认过才进第 2 轮。
    expect(result.state.phase).toBe('settle')
    const next = confirmBoth(result.state).state
    expect(next.round).toBe(2)
    expect(next.phase).toBe('play')
  })

  it('答对数更多时直接拿分，不受 Token 消耗影响', () => {
    // 甲场上 2 个、乙场上 1 个，全部答对。虽然甲本轮花了 2 点、乙一点没花，
    // 第一判据仍然让答对数量更多的甲拿分，不会提前落到 Token 比较。
    const quiz = twoVsOne()
    const first = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    expect(scoredOf(first.events)).toEqual({
      type: 'ROUND_SCORED',
      gains: [1, 0],
      scores: [2, 0],
      correctCounts: [2, 1],
      spent: [2, 0],
      verdict: 'more-correct',
    })

    // 下一轮双方都不再出牌，场上还是这三个 AI：甲仍以 2:1 的答对数拿分。
    const round3 = confirmBoth(first.state).state
    const second = execute(toQuiz(round3), {
      type: 'SUBMIT_ANSWERS',
      results: answersFor(round3),
    })
    expect(second.state.players.map((p) => p.score)).toEqual([3, 0])
  })

  it('双方确认后才交换先后手、各补 ROUND_DRAW_SIZE 张牌、宣告下一轮', () => {
    const quiz = duel('gpt-3-5', 'claude-5-sonnet')
    const handsBefore = quiz.players.map((p) => p.hand.length)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const result = confirmBoth(settle)

    expect(result.state.round).toBe(2)
    expect(result.state.firstPlayer).toBe(1)
    expect(result.state.activePlayer).toBe(1)
    expect(result.state.phase).toBe('play')
    expect(result.state.players.map((p) => p.hand.length)).toEqual(
      handsBefore.map((n) => n + ROUND_DRAW_SIZE),
    )
    // 两位玩家各抽 ROUND_DRAW_SIZE 张，之后才是宣告新一轮的那两条。
    expect(result.events.slice(-(ROUND_DRAW_SIZE * 2 + 2)).map((e) => e.type)).toEqual([
      ...Array.from({ length: ROUND_DRAW_SIZE * 2 }, () => 'CARD_DRAWN'),
      'ROUND_STARTED',
      'PLAY_TURN_STARTED',
    ])
    expect(result.events.at(-2)).toEqual({
      type: 'ROUND_STARTED',
      round: 2,
      firstPlayer: 1,
      category: result.state.questions[1]!.category,
      keywords: result.state.questions[1]!.keywords,
    })
    expect(result.events.at(-1)).toEqual({ type: 'PLAY_TURN_STARTED', player: 1 })
  })

  it('结果与场上 AI 对不上时整条拒绝', () => {
    const quiz = duel('gpt-3-5', 'claude-5-sonnet')
    const full = answersFor(quiz)
    const reject = { type: 'COMMAND_REJECTED', reason: '答题结果与场上 AI 不符' }

    // 漏掉一个在场的
    expect(execute(quiz, { type: 'SUBMIT_ANSWERS', results: full.slice(1) }).events).toEqual([
      reject,
    ])
    // 混进一个不在场的
    expect(
      execute(quiz, {
        type: 'SUBMIT_ANSWERS',
        results: [
          ...full,
          { instanceId: '幽灵', correct: true, answer: '占位', reasoning: '占位理由' },
        ],
      }).events,
    ).toEqual([reject])
    // 同一个 AI 提交两次（数量对得上，但漏了另一个）
    expect(
      execute(quiz, {
        type: 'SUBMIT_ANSWERS',
        results: [full[0]!, full[0]!],
      }).events,
    ).toEqual([reject])
    // 拒绝时状态原样返回
    expect(execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state).toBe(quiz)
  })

  it('不在答题阶段提交会被拒', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'SUBMIT_ANSWERS', results: [] })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是答题阶段' }])
    expect(result.state).toBe(game.state)
  })
})
