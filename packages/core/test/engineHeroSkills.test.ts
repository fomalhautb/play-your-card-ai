/**
 * 两个**被动**英雄技能：格蕾丝·霍珀的 Debug（抵消对方本局第一张技能牌）、
 * 阿达·洛芙莱斯的第一算法（开局多 ADA_TOKEN_MAX_BONUS 点上限）。
 *
 * 这两位没有对应的指令：Debug 是 src/enginePlay.ts 的 playCard 在结算前顺手触发的，
 * 第一算法是 src/engineSetup.ts 的 createGame 建玩家时就算进数值的，
 * 所以这一份也顺带守着"它们发不出 USE_HERO_SKILL"。
 * 两位主动英雄（要发指令的那种）在 engineHeroShift.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import type { GameEvent, InstanceId, PlayerId } from '../src/index'
import {
  ADA_TOKEN_MAX_BONUS,
  execute,
  INITIAL_TOKEN_MAX,
  other,
  TOKEN_MAX_GROWTH,
} from '../src/index'
import {
  answersFor,
  board,
  confirmBoth,
  deckOf,
  handCard,
  newGame,
  run,
  toQuiz,
} from './helpers/engineFixtures'

describe('英雄技能：Debug（格蕾丝·霍珀）', () => {
  /** 一张技能牌的完整事件对：出牌 + 被对手抵消。 */
  function cancelPair(player: PlayerId, instanceId: InstanceId): GameEvent[] {
    return [
      { type: 'SKILL_PLAYED', player, cardId: 'one-sentence-answer', instanceId },
      {
        type: 'SKILL_CANCELED',
        player,
        by: other(player),
        heroId: 'grace-hopper',
        cardId: 'one-sentence-answer',
        instanceId,
      },
    ]
  }

  it('对方打出的第一张技能牌被抵消，牌照常进弃牌堆', () => {
    const game = newGame({ deck0: deckOf('one-sentence-answer') })
    // 开局双方都没用过技能。
    expect(game.state.players.map((p) => p.hero)).toEqual(['grace-hopper', 'grace-hopper'])
    expect(game.state.players.map((p) => p.heroSkillUsed)).toEqual([false, false])

    const card = handCard(game.state, 0, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    // 抵消必须排在出牌之后：客户端先演牌飞出去，再演抵消。
    expect(result.events).toEqual(cancelPair(0, card.instanceId))
    // 发动的是对手（1 号）的英雄，出牌方自己的技能没被动用。
    expect(result.state.players[1].heroSkillUsed).toBe(true)
    expect(result.state.players[0].heroSkillUsed).toBe(false)
    // 抵消的是效果不是这次出牌：牌照样离开手牌进弃牌堆。
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([card.instanceId])
    expect(result.state.players[0].hand.some((c) => c.instanceId === card.instanceId)).toBe(false)
  })

  it('同一局第二张技能牌不再被抵消', () => {
    const game = newGame({ deck0: deckOf('one-sentence-answer') })
    const first = game.state.players[0].hand[0]!
    const second = game.state.players[0].hand[1]!
    const result = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: first.instanceId },
      { type: 'PLAY_CARD', player: 0, instanceId: second.instanceId },
    ])

    const canceled = result.events.filter((e) => e.type === 'SKILL_CANCELED')
    expect(canceled).toEqual([cancelPair(0, first.instanceId)[1]])
    expect(result.events.filter((e) => e.type === 'SKILL_PLAYED')).toHaveLength(2)
    expect(result.state.players[1].heroSkillUsed).toBe(true)
  })

  it('双方各自的第一张技能牌分别被对方抵消，两个标志互不影响', () => {
    const game = newGame({
      deck0: deckOf('one-sentence-answer'),
      deck1: deckOf('one-sentence-answer'),
    })
    const mine = handCard(game.state, 0, 'one-sentence-answer')
    const passed = run(game.state, [
      { type: 'PLAY_CARD', player: 0, instanceId: mine.instanceId },
      { type: 'END_PLAY', player: 0 },
    ])
    expect(passed.state.players[1].heroSkillUsed).toBe(true)
    expect(passed.state.players[0].heroSkillUsed).toBe(false)

    const theirs = handCard(passed.state, 1, 'one-sentence-answer')
    const result = execute(passed.state, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: theirs.instanceId,
    })

    expect(result.events).toEqual(cancelPair(1, theirs.instanceId))
    expect(result.state.players.map((p) => p.heroSkillUsed)).toEqual([true, true])
  })

  it('对手没有英雄时不发生抵消', () => {
    const game = newGame({ deck0: deckOf('one-sentence-answer'), hero1: null })
    const card = handCard(game.state, 0, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })

    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
    expect(result.state.players[1].hero).toBeNull()
    expect(result.state.players[1].heroSkillUsed).toBe(false)
  })

  it('重开一局后 Debug 又能用一次', () => {
    const first = newGame({ deck0: deckOf('one-sentence-answer') })
    const firstCard = handCard(first.state, 0, 'one-sentence-answer')
    const used = execute(first.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: firstCard.instanceId,
    })
    expect(used.state.players[1].heroSkillUsed).toBe(true)

    // "每局一次"的一局就是一个 GameState 的生命周期：重新 createGame 就回到没用过。
    const fresh = newGame({ deck0: deckOf('one-sentence-answer') })
    expect(fresh.state.players.map((p) => p.heroSkillUsed)).toEqual([false, false])
    const card = handCard(fresh.state, 0, 'one-sentence-answer')
    const again = execute(fresh.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    })
    expect(again.events).toEqual(cancelPair(0, card.instanceId))
  })

  it('DEBUG_PLAY_CARD 打出的技能牌同样被抵消', () => {
    // 调试出牌和正常出牌共用 playCard，抵消是顺带覆盖到的，不需要单独接一遍。
    const game = newGame({ deck1: deckOf('one-sentence-answer') })
    const card = handCard(game.state, 1, 'one-sentence-answer')
    const result = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    })

    expect(result.events).toEqual(cancelPair(1, card.instanceId))
    expect(result.state.players[0].heroSkillUsed).toBe(true)
  })
})

describe('英雄技能：第一算法（阿达·洛芙莱斯）', () => {
  it('开局余额和上限都比对手多 2，而且这个差一直保持到整局结束', () => {
    const game = newGame({ hero0: 'ada-lovelace', hero1: null })
    const ada = game.state.players[0]
    expect(ada.tokenMax).toBe(INITIAL_TOKEN_MAX + ADA_TOKEN_MAX_BONUS)
    expect(ada.tokens).toBe(INITIAL_TOKEN_MAX + ADA_TOKEN_MAX_BONUS)
    expect(game.state.players[1].tokenMax).toBe(INITIAL_TOKEN_MAX)
    expect(game.state.players[1].tokens).toBe(INITIAL_TOKEN_MAX)

    // 进下一轮走的是 tokenMax += TOKEN_MAX_GROWTH 的增量逻辑，所以加高的起点会一路带下去：
    // 第 2 轮对手 6 点、她 8 点，恒多 2 而不是只多在第 1 轮。
    const quiz = toQuiz(game.state)
    const answered = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const round2 = confirmBoth(answered).state
    expect(round2.round).toBe(2)
    expect(round2.players[0].tokenMax).toBe(
      INITIAL_TOKEN_MAX + ADA_TOKEN_MAX_BONUS + TOKEN_MAX_GROWTH,
    )
    expect(round2.players[0].tokens).toBe(round2.players[0].tokenMax)
    expect(round2.players[1].tokenMax).toBe(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
  })

  it('是被动，不占「每局一次」的标志，也发不出 USE_HERO_SKILL', () => {
    const game = newGame({ deck0: deckOf('gpt-2'), hero0: 'ada-lovelace', hero1: null })
    const card = handCard(game.state, 0, 'gpt-2')
    const state = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    }).state
    expect(state.players[0].heroSkillUsed).toBe(false)

    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '你的英雄没有可发动的技能' },
    ])
    expect(result.state).toBe(state)
  })
})
