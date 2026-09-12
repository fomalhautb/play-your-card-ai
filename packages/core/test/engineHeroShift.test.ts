/**
 * 两个**主动**英雄技能：陈丹琦的「精准检索」（升己方一个 AI）和
 * 梅拉妮·珀金斯的「化繁为简」（降对方一个 AI）。
 *
 * 对应 src/engineSkills.ts 的 useHeroSkill——两位共用同一条路径，升还是降、
 * 目标该在哪一侧全由英雄自己决定，指令里不带方向，所以"选错边"和"没有下一代"这些
 * 拒绝理由是这一份的重点。
 * 被动的那两位（霍珀、洛芙莱斯）在 engineHeroSkills.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { scriptedAnswers } from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import type { CardId } from '../src/index'
import { execute, upgradeTargetOf } from '../src/index'
import {
  board,
  CATALOG,
  deckOf,
  handCard,
  newGame,
  run,
  SEED_FIRST_1,
  toQuiz,
  toRound,
} from './helpers/engineFixtures'

describe('英雄技能：升降级（陈丹琦 / 梅拉妮·珀金斯）', () => {
  /** 甲带陈丹琦、场上一个自己的 GPT-2；乙不带英雄，免得霍珀的抵消掺和进来。 */
  function upgraderWithOwnAi(cardId: CardId = 'gpt-2') {
    const game = newGame({ deck0: deckOf(cardId), hero0: 'danqi-chen', hero1: null })
    const card = handCard(game.state, 0, cardId)
    return execute(game.state, { type: 'PLAY_CARD', player: 0, instanceId: card.instanceId }).state
  }

  /** 甲带梅拉妮·珀金斯；乙场上一个 AI（用调试指令上场，因为这时是甲的出牌轮）。 */
  function downgraderWithFoeAi(cardId: CardId = 'gpt-3-5') {
    const game = newGame({ deck1: deckOf(cardId), hero0: 'melanie-perkins', hero1: null })
    const card = handCard(game.state, 1, cardId)
    return execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: card.instanceId,
    }).state
  }

  it('升级把己方目标换成同系列下一代，完全免费也不结束出牌轮', () => {
    const state = upgraderWithOwnAi()
    const target = board(state, 0)[0]!
    const before = state.players[0]
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })

    const after = result.state.players[0]
    // 换的是 cardId 本身，levelShift 只是给界面画角标的净升降次数。
    expect(board(result.state, 0)).toEqual([
      { instanceId: target.instanceId, cardId: 'gpt-3-5', owner: 0, levelShift: 1 },
    ])
    expect(after.heroSkillUsed).toBe(true)
    // 免费：余额和本轮消耗都不动（打出那张 GPT-2 花掉的 1 点保持原样）。
    expect(after.tokens).toBe(before.tokens)
    expect(after.spentThisRound).toBe(before.spentThisRound)
    // 发动完还是自己的出牌轮，接着还能出牌。
    expect(result.state.activePlayer).toBe(0)
    expect(result.state.phase).toBe('play')
    expect(result.events).toEqual([
      {
        type: 'HERO_SKILL_USED',
        player: 0,
        heroId: 'danqi-chen',
        targetInstanceId: target.instanceId,
        fromCardId: 'gpt-2',
        toCardId: 'gpt-3-5',
        direction: 'upgrade',
      },
    ])
  })

  it('升级后答题按新卡的剧本走', () => {
    // 能力变化全靠"换成了另一张卡"：script.ts 那张静态表按 cardId 查，换完自然换了一整套回答。
    const state = upgraderWithOwnAi()
    const upgraded = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    }).state

    const question = upgraded.questions[0]!
    const [actual] = scriptedAnswers(question, board(upgraded, 0))
    const [asNewCard] = scriptedAnswers(question, [
      { instanceId: 'x', cardId: 'gpt-3-5', owner: 0 },
    ])
    const [asOldCard] = scriptedAnswers(question, [{ instanceId: 'x', cardId: 'gpt-2', owner: 0 }])
    expect(actual).toEqual({ ...asNewCard, instanceId: board(upgraded, 0)[0]!.instanceId })
    expect({ ...actual, instanceId: 'x' }).not.toEqual(asOldCard)
  })

  it('降级把对方目标换成同系列上一代', () => {
    const state = downgraderWithFoeAi()
    const target = board(state, 1)[0]!
    const foeBefore = state.players[1]
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)).toEqual([
      { instanceId: target.instanceId, cardId: 'gpt-2', owner: 1, levelShift: -1 },
    ])
    expect(result.state.players[0].heroSkillUsed).toBe(true)
    // 被降级的一方不退费也不扣费：他那张 GPT-3.5 的 2 点照旧记在账上。
    expect(result.state.players[1].tokens).toBe(foeBefore.tokens)
    expect(result.state.players[1].spentThisRound).toBe(foeBefore.spentThisRound)
    expect(result.events).toEqual([
      {
        type: 'HERO_SKILL_USED',
        player: 0,
        heroId: 'melanie-perkins',
        targetInstanceId: target.instanceId,
        fromCardId: 'gpt-3-5',
        toCardId: 'gpt-2',
        direction: 'downgrade',
      },
    ])
  })

  it('被干扰过的单位照样能升降级，两个标记互不影响', () => {
    // 乙先用「复读机」干扰甲场上的 GPT-2（乙不带英雄，所以这一张不会被抵消）。
    const state = upgraderWithOwnAi()
    const withSkill = run(state, [
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'fixed-answer' },
    ]).state
    const skill = withSkill.players[1].hand.at(-1)!
    const interfered = execute(withSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: skill.instanceId,
      targetInstanceId: board(withSkill, 0)[0]!.instanceId,
    }).state
    expect(board(interfered, 0)[0]!.interference).toBe('fixed-answer')

    const result = execute(interfered, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(interfered, 0)[0]!.instanceId,
    })
    // 升级只换卡面身份，干扰标记原样跟着这个单位走：它升完照样只会答「香蕉」。
    expect(board(result.state, 0)[0]).toEqual({
      instanceId: board(interfered, 0)[0]!.instanceId,
      cardId: 'gpt-3-5',
      owner: 0,
      interference: 'fixed-answer',
      // 英雄技能不记进 affectedBy（那份只记技能牌），它留下的是 levelShift。
      affectedBy: ['fixed-answer'],
      levelShift: 1,
    })
  })

  it('还没轮到自己出牌时被拒', () => {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      hero0: 'danqi-chen',
      hero1: 'melanie-perkins',
    })
    const card = handCard(game.state, 0, 'gpt-2')
    const state = execute(game.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    }).state

    // 乙的降级本来打得中甲这个单位，拦住他的是"没轮到你"。
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 1,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }])
    expect(result.state).toBe(state)
  })

  it('出牌阶段之外发不出来', () => {
    const state = upgraderWithOwnAi()
    const quiz = toQuiz(state)
    const result = execute(quiz, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(quiz, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '现在不是出牌阶段' }])
    expect(result.state).toBe(quiz)
  })

  it('每局只能发一次', () => {
    const state = upgraderWithOwnAi()
    const once = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    }).state

    // 升成 GPT-3.5 之后链上还有下一代，所以这次被拒只可能是因为技能已经用过了。
    expect(upgradeTargetOf(CATALOG, board(once, 0)[0]!.cardId)).toBe('gpt-4o')
    const result = execute(once, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(once, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '英雄技能这一局已经用过了' },
    ])
    expect(result.state).toBe(once)
  })

  it('升级指向对方场上的单位时被拒', () => {
    const game = newGame({
      deck0: deckOf('gpt-2'),
      deck1: deckOf('gpt-3-5'),
      hero0: 'danqi-chen',
      hero1: null,
    })
    const theirs = handCard(game.state, 1, 'gpt-3-5')
    const state = execute(game.state, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: theirs.instanceId,
    }).state

    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是你场上的 AI' }])
    expect(result.state).toBe(state)
  })

  it('降级指向自己场上的单位时被拒', () => {
    const state = downgraderWithFoeAi()
    const withMine = run(state, [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-3-5' }]).state
    const mine = withMine.players[0].hand.at(-1)!
    const deployed = execute(withMine, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: mine.instanceId,
    }).state

    const result = execute(deployed, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 AI' }])
    expect(result.state).toBe(deployed)
  })

  it('目标不在场上时被拒', () => {
    const state = upgraderWithOwnAi()
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: '不存在',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是你场上的 AI' }])
    expect(result.state).toBe(state)
  })

  it('已经是链上最新一代时升不动', () => {
    // DeepSeek V4 要 5 点，第 1 轮的 4 点买不起，先推到第 2 轮的 6 点。
    // 先手每轮交换，所以这里得让乙先手，第 2 轮才轮得到甲出牌和发技能。
    const game = newGame({
      seed: SEED_FIRST_1,
      deck0: deckOf('deepseek-v4'),
      hero0: 'danqi-chen',
      hero1: null,
    })
    const round2 = toRound(game.state, 2)
    const card = handCard(round2, 0, 'deepseek-v4')
    const state = execute(round2, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: card.instanceId,
    }).state

    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 没有可升级的下一代' },
    ])
    expect(result.state).toBe(state)
  })

  it('没有同系列其它代的卡升不了', () => {
    const state = upgraderWithOwnAi('gemini')
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 没有可升级的下一代' },
    ])
    expect(result.state).toBe(state)
  })

  it('已经是链上最早一代时降不动', () => {
    const state = downgraderWithFoeAi('gpt-2')
    const result = execute(state, {
      type: 'USE_HERO_SKILL',
      player: 0,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })
    expect(result.events).toEqual([
      { type: 'COMMAND_REJECTED', reason: '这个 AI 没有可降级的上一代' },
    ])
    expect(result.state).toBe(state)
  })

  it('霍珀和没英雄的一方发这条指令都会被拒', () => {
    for (const hero of ['grace-hopper', null] as const) {
      const game = newGame({ deck0: deckOf('gpt-2'), hero0: hero, hero1: null })
      const card = handCard(game.state, 0, 'gpt-2')
      const state = execute(game.state, {
        type: 'PLAY_CARD',
        player: 0,
        instanceId: card.instanceId,
      }).state

      const result = execute(state, {
        type: 'USE_HERO_SKILL',
        player: 0,
        targetInstanceId: board(state, 0)[0]!.instanceId,
      })
      expect(result.events).toEqual([
        { type: 'COMMAND_REJECTED', reason: '你的英雄没有可发动的技能' },
      ])
      // 霍珀的 Debug 是另一条路（打技能牌时触发），标志不该被这条指令碰过。
      expect(result.state.players[0].heroSkillUsed).toBe(false)
      expect(result.state).toBe(state)
    }
  })
})
