/**
 * 收场：一局什么时候结束、谁赢（对应 src/engineRound.ts 的 confirmRound 里 decided 那一段）。
 *
 * 和 engineRound.test.ts 管的是同一个函数的两半：那边问"双方确认之后局面怎么往前走"，
 * 这一份问"什么情况下不再往前走"。分成两份是因为这一半的用例几乎都要把一整局打完，
 * 摆盘方式和那边的单轮用例完全不同，混在一起读起来最费劲。
 * 收场的两条路（有人单独到 WIN_TARGET 分、题库出完保底判）都在这儿，
 * 外加对局结束之后一切指令都被拒。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { QUESTION_POOL, scriptedAnswers } from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import type { GameEvent, Question } from '../src/index'
import { execute, getCard, other, WIN_TARGET } from '../src/index'
import {
  answersFor,
  CATALOG,
  confirmBoth,
  deckOf,
  handCard,
  newGame,
  toQuiz,
} from './helpers/engineFixtures'

describe('胜负', () => {
  /**
   * 一局"甲一路碾压"的对局：甲开局派一张 AI 并一直答对，乙场上永远空着。
   * 于是每轮都是 more-correct，甲每轮 +1，第 3 轮结束就该收场。
   *
   * 每轮结算完都要双方确认才推进，所以循环里"算分"和"确认"是分开的两步。
   */
  function shutout(questions?: Question[]) {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      noShuffle: true,
      ...(questions === undefined ? {} : { questions }),
    })
    let state = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: game.state.players[0].hand[0]!.instanceId,
    }).state
    const events: GameEvent[] = []
    // 之后每轮双方都不再出牌：甲那张 AI 留在场上继续答对，乙一直是空场。
    for (let step = 0; step < 20 && state.phase !== 'finished'; step++) {
      const quiz = toQuiz(state)
      const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
      events.push(...scored.events)
      const confirmed = confirmBoth(scored.state)
      state = confirmed.state
      events.push(...confirmed.events)
    }
    return { state, events }
  }

  it('先到 WIN_TARGET 分就结束，题库还剩题也照样收场', () => {
    const { state, events } = shutout()
    expect(state.totalRounds).toBe(QUESTION_POOL.length)

    expect(state.phase).toBe('finished')
    expect(state.winner).toBe(0)
    expect(state.players.map((p) => p.score)).toEqual([WIN_TARGET, 0])
    // 三轮打完就收，题库里还剩两道没用上。
    expect(state.round).toBe(WIN_TARGET)
    expect(state.round).toBeLessThan(state.totalRounds)
    expect(events.filter((e) => e.type === 'ROUND_SCORED')).toHaveLength(WIN_TARGET)
    expect(events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 0 })
    // 打完了就不再宣告下一轮，也不补牌。
    const tail = events.slice(events.findIndex((e) => e.type === 'GAME_OVER'))
    expect(tail.some((e) => e.type === 'ROUND_STARTED')).toBe(false)
  })

  it('双方同时到 WIN_TARGET 分不算结束，继续加赛到有人单独领先', () => {
    // 双方都不出牌 = 同错同消耗，每轮 equal-tokens 各 +1，三轮打完是 3:3。
    // 甲用单卡牌组，加赛那一轮手上必定还有 GPT-2 可派。
    let state = newGame({ deck0: deckOf('gpt-2'), noShuffle: true }).state
    for (let round = 0; round < WIN_TARGET; round++) {
      const quiz = toQuiz(state)
      const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
      state = confirmBoth(scored).state
    }
    expect(state.players.map((p) => p.score)).toEqual([WIN_TARGET, WIN_TARGET])
    expect(state.phase).toBe('play')
    expect(state.winner).toBeNull()
    expect(state.round).toBe(WIN_TARGET + 1)

    // 加赛这一轮甲派一张 AI 并答对，乙仍然空场：4:3，这才分出胜负。
    const played = execute(state, {
      type: 'DEBUG_PLAY_CARD',
      player: 0,
      instanceId: handCard(state, 0, 'gpt-2').instanceId,
    }).state
    const quiz = toQuiz(played)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) })
    // 算完分只到 settle，终局要等双方点确认。
    expect(settle.state.phase).toBe('settle')
    expect(settle.events.some((e) => e.type === 'GAME_OVER')).toBe(false)

    const result = confirmBoth(settle.state)
    expect(result.state.phase).toBe('finished')
    expect(result.state.winner).toBe(0)
    expect(result.state.players.map((p) => p.score)).toEqual([WIN_TARGET + 1, WIN_TARGET])
  })

  it('题库出完还没人到线时保底判：总分高的一方获胜', () => {
    // 只有两道题，甲连拿两分也到不了 3 分，靠"题出完了"这条兜底收场。
    const { state } = shutout(QUESTION_POOL.slice(0, 2))
    expect(state.phase).toBe('finished')
    expect(state.round).toBe(state.totalRounds)
    expect(state.players.map((p) => p.score)).toEqual([2, 0])
    expect(state.winner).toBe(0)
  })

  it('题库出完且总分相同时才是平局', () => {
    // 双方一张牌都不打，每轮 equal-tokens 各 +1，一路打到题库出完仍然同分。
    let state = newGame().state
    const events: GameEvent[] = []
    while (state.phase !== 'finished') {
      const quiz = toQuiz(state)
      const scored = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] })
      events.push(...scored.events)
      const confirmed = confirmBoth(scored.state)
      state = confirmed.state
      events.push(...confirmed.events)
    }

    expect(state.round).toBe(state.totalRounds)
    expect(state.players.map((p) => p.score)).toEqual([QUESTION_POOL.length, QUESTION_POOL.length])
    expect(state.winner).toBe('draw')
    expect(events.at(-1)).toEqual({ type: 'GAME_OVER', winner: 'draw' })
  })

  it('对局结束后一切指令都被拒', () => {
    const finished = shutout(QUESTION_POOL.slice(0, 1)).state
    expect(finished.phase).toBe('finished')

    const result = execute(finished, { type: 'DEBUG_SKIP_TO_QUIZ' })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '对局已结束' }])
    expect(result.state).toBe(finished)
    // 确认指令也一样，结算阶段已经过去了。
    expect(execute(finished, { type: 'CONFIRM_ROUND', player: 0 }).events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '对局已结束' },
    ])
  })

  it('用预生成回答从头打到尾能正常收场', () => {
    let state = newGame().state
    const events: GameEvent[] = []
    // 每一步只推进一小格，步数上限纯粹是防死循环，正常远用不满。
    for (let step = 0; step < 200 && state.phase !== 'finished'; step++) {
      if (state.phase === 'play') {
        const seat = state.activePlayer
        for (const card of [...state.players[seat].hand]) {
          // 要选目标的技能牌得照客户端那样挑一个对方还没被干扰的 AI。
          // 挑不到就跳过这张牌：硬打会被引擎拒掉，而这个用例要求整局一条 COMMAND_REJECTED 都没有。
          const definition = getCard(CATALOG, card.cardId)
          // Token 不够的牌跳过：硬打会被拒。客户端那边这些牌是画成灰的、根本拖不动。
          if (definition.tokenCost > state.players[seat].tokens) continue
          const target =
            definition.kind === 'skill' && definition.target === 'foe-ai'
              ? state.players[other(seat)].board.find((a) => a.interference === undefined)
              : undefined
          if (
            definition.kind === 'skill' &&
            definition.target !== undefined &&
            target === undefined
          )
            continue
          const played = execute(state, {
            type: 'PLAY_CARD',
            player: seat,
            instanceId: card.instanceId,
            ...(target === undefined ? {} : { targetInstanceId: target.instanceId }),
          })
          state = played.state
          events.push(...played.events)
        }
        const ended = execute(state, { type: 'END_PLAY', player: seat })
        state = ended.state
        events.push(...ended.events)
      } else if (state.phase === 'settle') {
        // 结算停在这里等两位玩家各自点确认，界面上那两下在这里补齐。
        const confirmed = confirmBoth(state)
        state = confirmed.state
        events.push(...confirmed.events)
      } else {
        // driver 就是这么干的：拿本轮题目和场上全部 AI 去查预生成答案表，再把结果喂回引擎。
        const question = state.questions[state.round - 1]!
        const aiUnits = [...state.players[0].board, ...state.players[1].board]
        const scored = execute(state, {
          type: 'SUBMIT_ANSWERS',
          results: scriptedAnswers(question, aiUnits),
        })
        state = scored.state
        events.push(...scored.events)
      }
    }

    expect(state.phase).toBe('finished')
    // 现在不一定打满题库：先到 WIN_TARGET 分就收场，所以只能断言没超。
    expect(state.round).toBeLessThanOrEqual(state.totalRounds)
    expect(state.winner).not.toBeNull()
    expect(events.filter((e) => e.type === 'ROUND_SCORED')).toHaveLength(state.round)
    // 每轮两条确认，一条都不能少。
    expect(events.filter((e) => e.type === 'ROUND_CONFIRMED')).toHaveLength(state.round * 2)
    expect(events.filter((e) => e.type === 'GAME_OVER')).toHaveLength(1)
    expect(events.some((e) => e.type === 'COMMAND_REJECTED')).toBe(false)
  })
})
