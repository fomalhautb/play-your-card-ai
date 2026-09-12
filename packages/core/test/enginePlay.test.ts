/**
 * 出牌阶段：打牌、轮次、结束出牌（对应 src/enginePlay.ts）。
 *
 * 这一份只管「牌打不打得出去、打出去之后局面变成什么样」和「这一轮出牌怎么收尾」。
 * 两块相邻的东西各有自己的文件：
 * - 费用怎么算、额度怎么涨 → engineTokens.test.ts；
 * - 技能牌打出去之后发生了什么 → engineSkills*.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import { execute, INITIAL_TOKEN_MAX, STARTING_HAND_SIZE } from '../src/index'
import { board, deckOf, handCard, newGame, nextRound, run, toQuiz } from './helpers/engineFixtures'

describe('出牌阶段', () => {
  it('技能牌 Token 够就想打几张打几张，AI 牌上场、技能牌进弃牌堆', () => {
    // 不洗牌，把起手固定成「1 张 AI + 4 张技能」：两种牌都只要 1 点，
    // 第 1 轮的 5 点正好全买下（牌堆顶在数组末尾，见 GameSetup.noShuffle）。
    const game = newGame({
      noShuffle: true,
      deck0: [...deckOf('gpt-2', 7), ...deckOf('one-sentence-answer', 4), 'gpt-2'],
    })
    expect(game.state.players[0].hand.map((c) => c.cardId)).toEqual([
      'gpt-2',
      'one-sentence-answer',
      'one-sentence-answer',
      'one-sentence-answer',
      'one-sentence-answer',
    ])
    const result = run(
      game.state,
      game.state.players[0].hand.map((card) => ({
        type: 'PLAY_CARD',
        player: 0,
        instanceId: card.instanceId,
      })),
    )

    const player = result.state.players[0]
    expect(player.hand).toHaveLength(0)
    expect(player.tokens).toBe(0)
    expect(player.spentThisRound).toBe(INITIAL_TOKEN_MAX)
    expect(player.board.map((a) => a.cardId)).toEqual(['gpt-2'])
    expect(player.board.every((a) => a.owner === 0)).toBe(true)
    // 出牌不推进阶段，出完还是自己在出。
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.phase).toBe('play')
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)

    expect(result.events.filter((e) => e.type === 'AI_DEPLOYED')).toHaveLength(1)
    const skills = result.events.filter((e) => e.type === 'SKILL_PLAYED')
    expect(skills).toHaveLength(4)
    expect(skills).toHaveLength(player.discard.length)
    expect(player.discard.every((c) => c.cardId === 'one-sentence-answer')).toBe(true)
    // 每条事件都报出了那张牌自己的实例 id，客户端才能在手牌里把它揪出来播动画。
    expect(skills.map((e) => e.instanceId).sort()).toEqual(
      player.discard.map((c) => c.instanceId).sort(),
    )
  })

  it('起手就是 STARTING_HAND_SIZE 张，出一张少一张', () => {
    const game = newGame({ deck0: deckOf('gpt-2') })
    expect(game.state.players[0].hand).toHaveLength(STARTING_HAND_SIZE)
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    })
    expect(result.state.players[0].hand).toHaveLength(STARTING_HAND_SIZE - 1)
  })

  it('AI 牌上场后沿用手牌那一份实例 id', () => {
    const game = newGame({ deck0: deckOf('claude-5-sonnet') })
    const card = handCard(game.state, 0, 'claude-5-sonnet')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(board(result.state, 0)).toEqual([
      { instanceId: card.instanceId, cardId: 'claude-5-sonnet', owner: 0 },
    ])
    expect(result.events).toEqual([
      {
        type: 'AI_DEPLOYED',
        player: 0,
        ai: { instanceId: card.instanceId, cardId: 'claude-5-sonnet', owner: 0 },
      },
    ])
  })

  it('还没轮到自己出牌时被拒，状态原样返回', () => {
    const game = newGame()
    const card = game.state.players[1].hand[0]!
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }])
    expect(result.state).toBe(game.state)
  })

  it('打一张不在手牌里的卡时被拒', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'PLAY_CARD', player: 0, instanceId: '不存在' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '手牌里没有这张卡' }])
    expect(result.state).toBe(game.state)
  })
})

describe('一轮里派几张新 AI 都行', () => {
  it('第二张 AI 牌照常打得出，两张一起进场', () => {
    // GPT-2 只要 1 点，第 1 轮的 5 点连打两张还有富余：唯一能拦住第二张的只有费用。
    const game = newGame({ deck0: deckOf('gpt-2'), noShuffle: true })
    const [first, second] = game.state.players[0].hand
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
    }).state

    const again = execute(played, { type: 'PLAY_CARD', player: 0, instanceId: second!.instanceId })
    expect(again.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    expect(board(again.state, 0)).toHaveLength(2)
    // 两张各扣各的费，本轮消耗是两张之和（答对数量相同时比的就是它）。
    expect(again.state.players[0].tokens).toBe(INITIAL_TOKEN_MAX - 2)
    expect(again.state.players[0].spentThisRound).toBe(2)
  })

  it('拦住第二张的只剩 Token：额度花光了才被拒', () => {
    // ChatGPT 5.6 Sol 一张 7 点，第 1 轮只有 5 点，第一张就打不起；
    // 换成 4 点的 GPT-4o，打完只剩 1 点，第二张被拒的理由是费用而不是张数。
    const game = newGame({ deck0: deckOf('gpt-4o'), noShuffle: true })
    const [first, second] = game.state.players[0].hand
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
    }).state
    expect(played.players[0].tokens).toBe(INITIAL_TOKEN_MAX - 4)

    expect(
      execute(played, { type: 'PLAY_CARD', player: 0, instanceId: second!.instanceId }).events,
    ).toEqual([{ type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 4 点，只剩 1 点' }])
  })

  it('跨轮累积：上一轮那张留场，这一轮接着派', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), noShuffle: true })
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const round2 = nextRound(played)

    expect(round2.round).toBe(2)
    const again = execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(round2, 0, 'gpt-2').instanceId,
    })
    expect(again.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    expect(board(again.state, 0)).toHaveLength(2)
  })
})

describe('结束出牌', () => {
  it('先手结束后轮到后手，后手结束进答题阶段', () => {
    const game = newGame()
    const first = execute(game.state, { type: 'END_PLAY', player: 0 })
    expect(first.state.phase).toBe('play')
    expect(first.state.activePlayer).toBe(1)
    expect(first.events).toEqual([{ type: 'PLAY_TURN_STARTED', player: 1 }])

    const second = execute(first.state, { type: 'END_PLAY', player: 1 })
    expect(second.state.phase).toBe('quiz')
    // 引擎发的是完整的那道题（含答案）；下发给客户端前答案由 filterEvent 摘掉，
    // 那一步在 view.test.ts 里守着。
    expect(second.events).toEqual([
      { type: 'QUESTION_REVEALED', question: game.state.questions[0] },
    ])
  })

  it('后手还没结束时先手不能替他结束', () => {
    const game = newGame()
    const passed = execute(game.state, { type: 'END_PLAY', player: 0 }).state
    const result = execute(passed, { type: 'END_PLAY', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }])
    expect(result.state).toBe(passed)
  })

  it('答题阶段既不能出牌也不能结束出牌', () => {
    const quiz = toQuiz(newGame().state)
    const card = quiz.players[1].hand[0]!

    const played = execute(quiz, { type: 'PLAY_CARD', player: 1, instanceId: card.instanceId })
    expect(played.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(played.state).toBe(quiz)

    const ended = execute(quiz, { type: 'END_PLAY', player: 1 })
    expect(ended.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(ended.state).toBe(quiz)
  })
})
