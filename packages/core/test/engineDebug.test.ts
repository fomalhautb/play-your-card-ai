/**
 * dev 测试房的四条调试指令。
 *
 * 加牌 / 弃牌对应 src/engineDebug.ts；另外两条只是绕开一条检查、结算复用正经路径
 *（DEBUG_PLAY_CARD 走 enginePlay.ts 的 playCard，DEBUG_SKIP_TO_QUIZ 走 skipToQuiz），
 * 所以这里守的重点是"绕开的**只有**那一条"：费用、目标校验、轮次推进全都不该跟着变。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/index'
import { execute } from '../src/index'
import { board, deckOf, handCard, newGame, run, toQuiz } from './helpers/engineFixtures'

describe('调试指令：DEBUG_SKIP_TO_QUIZ', () => {
  it('出牌阶段直接跳到答题', () => {
    const game = newGame()
    const result = execute(game.state, { type: 'DEBUG_SKIP_TO_QUIZ' })

    expect(result.state.phase).toBe('quiz')
    expect(result.events).toEqual([
      { type: 'QUESTION_REVEALED', question: game.state.questions[0] },
    ])
  })

  it('已经在答题阶段时被拒', () => {
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'DEBUG_SKIP_TO_QUIZ' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(result.state).toBe(quiz)
  })
})

describe('调试指令：DEBUG_ADD_CARD', () => {
  it('不带 cardId 时从自己牌堆抽一张', () => {
    const game = newGame()
    const before = game.state.players[1]
    const result = execute(game.state, { type: 'DEBUG_ADD_CARD', player: 1 })

    const after = result.state.players[1]
    expect(after.hand).toHaveLength(before.hand.length + 1)
    expect(after.deck).toHaveLength(before.deck.length - 1)
    expect(result.events).toEqual([{ type: 'CARD_DRAWN', player: 1, card: after.hand.at(-1) }])
  })

  it('带 cardId 时凭空造牌，不动牌堆，实例 id 不重复', () => {
    const game = newGame()
    const deckBefore = game.state.players[0].deck.length
    const handBefore = game.state.players[0].hand.length
    const result = run(game.state, [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gemini' },
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gemini' },
    ])

    const player = result.state.players[0]
    expect(player.deck).toHaveLength(deckBefore)
    expect(player.hand).toHaveLength(handBefore + 2)
    const added = player.hand.slice(-2)
    expect(added.map((c) => c.cardId)).toEqual(['gemini', 'gemini'])
    expect(added[0]!.instanceId).not.toBe(added[1]!.instanceId)
    // 造出来的实例不属于任何一副牌组，客户端靠 dbg- 前缀就能认出来。
    expect(added.every((c) => c.instanceId.startsWith('dbg-'))).toBe(true)
  })

  it('牌堆空时被拒绝', () => {
    const game = newGame()
    const empty: GameState = {
      ...game.state,
      players: [{ ...game.state.players[0], deck: [] }, game.state.players[1]],
    }
    const result = execute(empty, { type: 'DEBUG_ADD_CARD', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '牌堆已空' }])
    expect(result.state).toBe(empty)
  })

  it('卡牌 id 不存在时被拒绝而不是抛异常', () => {
    const game = newGame()
    const result = execute(game.state, {
      type: 'DEBUG_ADD_CARD',
      player: 0,
      cardId: 'not-a-card',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '未知卡牌：not-a-card' }])
    expect(result.state).toBe(game.state)
  })

  it('答题阶段也能用：测试房要能提前把手牌摆好', () => {
    const quiz = toQuiz(newGame().state)
    const result = execute(quiz, { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-3-5' })
    expect(result.state.players[0].hand.at(-1)!.cardId).toBe('gpt-3-5')
    expect(result.state.phase).toBe('quiz')
  })
})

describe('调试指令：DEBUG_REMOVE_CARD', () => {
  it('不指定实例时弃掉手牌最后一张', () => {
    const game = newGame()
    const last = game.state.players[0].hand.at(-1)!
    const result = execute(game.state, { type: 'DEBUG_REMOVE_CARD', player: 0 })

    const player = result.state.players[0]
    expect(player.hand.some((c) => c.instanceId === last.instanceId)).toBe(false)
    expect(player.discard).toEqual([last])
    expect(result.events).toEqual([
      { type: 'CARD_REMOVED', player: 0, instanceId: last.instanceId },
    ])
  })

  it('指定实例时弃掉那一张', () => {
    const game = newGame()
    const first = game.state.players[0].hand[0]!
    const result = execute(game.state, {
      type: 'DEBUG_REMOVE_CARD',
      player: 0,
      instanceId: first.instanceId,
    })

    const player = result.state.players[0]
    expect(player.hand.some((c) => c.instanceId === first.instanceId)).toBe(false)
    expect(player.discard).toEqual([first])
  })

  it('手牌为空时被拒绝', () => {
    const game = newGame()
    const noHand: GameState = {
      ...game.state,
      players: [{ ...game.state.players[0], hand: [] }, game.state.players[1]],
    }
    const result = execute(noHand, { type: 'DEBUG_REMOVE_CARD', player: 0 })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '手牌为空' }])
    expect(result.state).toBe(noHand)
  })

  it('指定的实例不在手牌里时被拒绝', () => {
    const game = newGame()
    const result = execute(game.state, {
      type: 'DEBUG_REMOVE_CARD',
      player: 0,
      instanceId: '不存在',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '手牌里没有这张卡' }])
    expect(result.state).toBe(game.state)
  })
})

describe('调试指令：DEBUG_PLAY_CARD', () => {
  it('还没轮到的一方也能出牌，结算和正常出牌一致', () => {
    const game = newGame({ deck1: deckOf('deepseek-r1') })
    expect(game.state.activePlayer).toBe(0)

    const card = handCard(game.state, 1, 'deepseek-r1')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(board(result.state, 1).map((a) => a.cardId)).toEqual(['deepseek-r1'])
    expect(result.events.map((e) => e.type)).toEqual(['AI_DEPLOYED'])
    // 只免掉"轮到谁"这一条检查，出牌本身仍然要在出牌阶段。
    expect(result.state.activePlayer).toBe(0)
  })

  it('技能牌照样进弃牌堆', () => {
    const game = newGame({ deck1: deckOf('one-sentence-answer') })
    const card = handCard(game.state, 1, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(result.state.players[1].discard.map((c) => c.cardId)).toEqual(['one-sentence-answer'])
    // instanceId 是打出的那张技能牌自己，客户端靠它定位起飞的手牌。
    // 调试出牌和正常出牌走同一个 playCard，所以对手的 Debug 照样抵消这一张（见下面的英雄用例）。
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 1,
        cardId: 'one-sentence-answer',
        instanceId: card.instanceId,
      },
      {
        type: 'SKILL_CANCELED',
        player: 1,
        by: 0,
        heroId: 'grace-hopper',
        cardId: 'one-sentence-answer',
        instanceId: card.instanceId,
      },
    ])
    expect(result.state.players[0].heroSkillUsed).toBe(true)
  })

  it('答题阶段也不能出牌', () => {
    const quiz = toQuiz(newGame().state)
    const card = quiz.players[0].hand[0]!
    const result = execute(quiz, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(result.state).toBe(quiz)
  })
})

describe('调试指令的边界', () => {
  it('加牌/弃牌/替对手出牌都不推进轮次', () => {
    const game = newGame({ deck1: deckOf('gpt-3-5') })
    const card = handCard(game.state, 1, 'gpt-3-5')
    const result = run(game.state, [
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'one-sentence-answer' },
      { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: card.instanceId },
      { type: 'DEBUG_REMOVE_CARD', player: 1 },
    ])

    expect(result.state.round).toBe(game.state.round)
    expect(result.state.activePlayer).toBe(game.state.activePlayer)
    expect(result.state.phase).toBe(game.state.phase)
    expect(result.events.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
    expect(result.events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)
  })
})
