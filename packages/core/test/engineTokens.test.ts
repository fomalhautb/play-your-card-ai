/**
 * Token：额度怎么发、怎么扣、怎么涨、怎么记本轮消耗。
 *
 * 单独一份而不是跟着某个引擎文件走，是因为这条规则横跨两处：
 * 扣费和"打不起就拒"在 src/enginePlay.ts（effectivePlayCost / playCard），
 * 每轮补满并抬高上限在 src/engineRound.ts（confirmRound）。
 * 拆到两个文件里的话，"省下的不跨轮累积"这种前后连着看才成立的用例就没地方放了。
 *
 * 核电站那张牌怎么改费用不在这儿，在 engineSkillsEffects.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import { execute, getCard, INITIAL_TOKEN_MAX, TOKEN_MAX_GROWTH } from '../src/index'
import {
  answersFor,
  board,
  CATALOG,
  confirmBoth,
  deckOf,
  handCard,
  newGame,
  nextRound,
  run,
  toQuiz,
} from './helpers/engineFixtures'

describe('Token', () => {
  it('开局双方各拿满第 1 轮的额度', () => {
    const game = newGame()
    for (const player of game.state.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX)
      expect(player.tokens).toBe(INITIAL_TOKEN_MAX)
    }
  })

  it('出牌按卡面费用扣，扣的是打出方自己的额度', () => {
    // GPT-3.5 是 2 点，第 1 轮 4 点打一张还剩 2 点。
    const game = newGame({ deck0: deckOf('gpt-3-5') })
    const card = handCard(game.state, 0, 'gpt-3-5')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.state.players[0].tokens).toBe(
      INITIAL_TOKEN_MAX - getCard(CATALOG, 'gpt-3-5').tokenCost,
    )
    expect(result.state.players[0].tokenMax).toBe(INITIAL_TOKEN_MAX)
    // 对方的额度一点没动。
    expect(result.state.players[1].tokens).toBe(INITIAL_TOKEN_MAX)
  })

  it('剩余 Token 不够时被拒，状态原样返回', () => {
    // Claude Fable 5 要 7 点，第 1 轮只有 5 点，怎么都打不出。
    const game = newGame({ deck0: deckOf('claude-fable-5') })
    const card = handCard(game.state, 0, 'claude-fable-5')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events).toEqual([
      {
        type: 'COMMAND_REJECTED',
        reason: `Token 不够：这张牌要 7 点，只剩 ${INITIAL_TOKEN_MAX} 点`,
      },
    ])
    expect(result.state).toBe(game.state)
  })

  it('费用不够的技能牌连目标都不用挑就被拒', () => {
    // 校验顺序：费用在选目标之前，不然玩家会挑完目标才被告知打不起。
    const game = newGame({ deck0: deckOf('fixed-answer'), deck1: deckOf('gpt-2') })
    // 乙先摆一个 AI：场上摆着合法目标，下面被拒就只可能是费用那道闸拦的。
    const foeAi = run(game.state, [
      {
        type: 'DEBUG_PLAY_CARD',
        player: 1,
        instanceId: handCard(game.state, 1, 'gpt-2').instanceId,
      },
    ]).state
    // 甲先用 4 点买一张 GPT-4o，第 1 轮的 5 点只剩 1 点，买不起 4 点的「复读机」。
    const added = run(foeAi, [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-4o' }]).state
    const drained = execute(added, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(added, 0, 'gpt-4o').instanceId,
    }).state
    expect(drained.players[0].tokens).toBe(INITIAL_TOKEN_MAX - getCard(CATALOG, 'gpt-4o').tokenCost)

    // 这一张连目标都没给，但报的是费用不够——费用那道闸排在前面。
    const skill = handCard(drained, 0, 'fixed-answer')
    const result = execute(drained, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: 'Token 不够：这张牌要 4 点，只剩 1 点' },
    ])
  })

  it('每轮双方确认后补满并抬高上限，省下的不跨轮累积', () => {
    const game = newGame({ deck0: deckOf('gpt-3-5'), deck1: deckOf('gpt-3-5') })
    // 甲花掉 2 点，乙一点没花——下一轮两边一样满。
    const played = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(game.state, 0, 'gpt-3-5').instanceId,
    }).state
    const quiz = toQuiz(played)
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    // 结算期间额度保持本轮的样子，界面靠它显示"本轮消耗"。
    expect(settle.players[0].tokens).toBe(INITIAL_TOKEN_MAX - getCard(CATALOG, 'gpt-3-5').tokenCost)
    const next = confirmBoth(settle).state

    expect(next.round).toBe(2)
    for (const player of next.players) {
      expect(player.tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
      expect(player.tokens).toBe(player.tokenMax)
    }
  })

  it('上限逐轮线性增长：第 n 轮是 INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH × (n - 1)', () => {
    // 双方都不出牌 = 消耗都是 0，每轮都是 equal-tokens 各 +1，
    // 所以第 3 轮结束时双方 3:3 要加赛，一路打到题库出完才收场。
    let state = newGame().state
    const maxes: number[] = []
    while (state.phase !== 'finished') {
      if (state.phase === 'play') {
        maxes.push(state.players[0].tokenMax)
        state = toQuiz(state)
      } else if (state.phase === 'settle') {
        state = confirmBoth(state).state
      } else {
        state = execute(state, { type: 'SUBMIT_ANSWERS', results: answersFor(state) }).state
      }
    }
    expect(maxes).toEqual(maxes.map((_, index) => INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * index))
    expect(maxes).toHaveLength(state.totalRounds)
  })
})

describe('本轮 Token 消耗（spentThisRound）', () => {
  it('AI 牌和技能牌都累加，每轮清零', () => {
    // 起手固定成「GPT-2（1 点）+ 复读机（4 点）+ 3 张 GPT-2」：那两张正好花光第 1 轮的 5 点。
    // 对面摆个 AI 好让复读机挑得到目标。
    const game = newGame({
      noShuffle: true,
      deck0: [...deckOf('gpt-2', 10), 'fixed-answer', 'gpt-2'],
      deck1: deckOf('gpt-2'),
      // 乙不带英雄，免得 Debug 把那张技能牌抵消掉——抵消也计消耗是下一条用例的事。
      hero1: null,
    })
    const foeAi = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(game.state, 1, 'gpt-2').instanceId,
    }).state
    expect(foeAi.players[0].spentThisRound).toBe(0)

    const withAi = execute(foeAi, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(foeAi, 0, 'gpt-2').instanceId,
    }).state
    expect(withAi.players[0].spentThisRound).toBe(1)

    const withSkill = execute(withAi, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: handCard(withAi, 0, 'fixed-answer').instanceId,
      targetInstanceId: board(withAi, 1)[0]!.instanceId,
    }).state
    expect(withSkill.players[0].spentThisRound).toBe(5)
    // 两边各记各的：乙只打了那张 1 点的 GPT-2，不受甲花了多少影响。
    expect(withSkill.players[1].spentThisRound).toBe(getCard(CATALOG, 'gpt-2').tokenCost)

    // 下一轮从头算。
    const round2 = nextRound(withSkill)
    expect(round2.players.map((p) => p.spentThisRound)).toEqual([0, 0])
  })

  it('技能牌被英雄技能抵消也计入：Token 是真花出去的，作废的只是效果', () => {
    // 乙带默认英雄格蕾丝·霍珀，会抵消甲本局第一张技能牌。
    const game = newGame({ deck0: deckOf('one-sentence-answer'), hero0: null })
    const card = handCard(game.state, 0, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events.some((e) => e.type === 'SKILL_CANCELED')).toBe(true)
    expect(result.state.players[0].spentThisRound).toBe(
      getCard(CATALOG, 'one-sentence-answer').tokenCost,
    )
    expect(result.state.players[0].tokens).toBe(
      INITIAL_TOKEN_MAX - getCard(CATALOG, 'one-sentence-answer').tokenCost,
    )
  })
})
