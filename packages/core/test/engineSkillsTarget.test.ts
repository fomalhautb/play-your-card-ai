/**
 * 要选目标的技能牌：目标合不合法那套校验，以及它和英雄抵消撞在一起时的表现。
 *
 * 对应 src/enginePlay.ts 的 denyReason（四档 `target` 各一条判断）和 playCard 里那段
 * "先问会不会被抵消，再决定要不要结算效果"。
 * 每张牌**打中之后**各自做了什么在 engineSkillsMarks / engineSkillsEffects 两份里。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import { execute } from '../src/index'
import { board, deckOf, handCard, newGame, run, stageTwoFoeAis } from './helpers/engineFixtures'

describe('要选目标的技能牌', () => {
  /**
   * 摆一个「甲满手复读机、乙场上两个 AI」的出牌阶段局面。
   *
   * 乙的 AI 用调试指令上场：这时行动方是甲，走正常出牌轮不到乙。
   * 双方都不带英雄：默认英雄格蕾丝·霍珀会抵消对方本局第一张技能牌，
   * 而抵消掉的技能不留 interference（见 playCard），那样这一组用例测的就不是目标规则了。
   * 抵消和目标撞在一起的情况单独有一节（见下面「英雄抵消 × 要选目标的技能牌」）。
   */
  function foeHasAis() {
    const game = newGame({
      firstPlayer: 1,
      deck0: deckOf('fixed-answer'),
      // 乙用 1 点的 GPT-2 摆场，甲每轮跟一张同费用的，双方消耗一直持平。
      deck1: deckOf('gpt-2'),
      hero0: null,
      hero1: null,
    })
    return stageTwoFoeAis(game.state, 'gpt-2')
  }

  it('不带目标时被拒', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'fixed-answer')
    const result = execute(state, { type: 'PLAY_CARD', player: 0, instanceId: skill.instanceId })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '这张技能牌要先指定目标' }])
    expect(result.state).toBe(state)
  })

  it('目标不在场上时被拒', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'fixed-answer')
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: '不存在',
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 AI' }])
    expect(result.state).toBe(state)
  })

  it('目标是自己场上的 AI 时被拒（干扰只能打对面）', () => {
    // 甲的牌组里全是技能牌，所以自己那个 AI 得靠调试指令凭空造一张再打出来。
    const withMine = run(foeHasAis(), [{ type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-3-5' }])
    const added = withMine.state.players[0].hand.at(-1)!
    const deployed = execute(withMine.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: added.instanceId,
    }).state

    const skill = handCard(deployed, 0, 'fixed-answer')
    const result = execute(deployed, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(deployed, 0)[0]!.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '目标必须是对方场上的 AI' }])
    expect(result.state).toBe(deployed)
  })

  it('打中之后目标被标上是哪张干扰牌，事件带上目标 id', () => {
    const state = foeHasAis()
    const skill = handCard(state, 0, 'fixed-answer')
    const target = board(state, 1)[0]!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: target.instanceId,
    })

    expect(board(result.state, 1)[0]).toEqual({
      ...target,
      interference: 'fixed-answer',
      // 展示用的那一份也要跟着写上，小卡才挂得出角标（见 state.ts 的 affectedBy）。
      affectedBy: ['fixed-answer'],
    })
    // 只标中选的那一个，同排另一个不受影响。
    expect(board(result.state, 1)[1]!.interference).toBeUndefined()
    // 技能牌自己照常进弃牌堆。
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toEqual([skill.instanceId])
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'fixed-answer',
        instanceId: skill.instanceId,
        targetInstanceId: target.instanceId,
      },
    ])
  })

  it('同一个 AI 不能被干扰两次', () => {
    const state = foeHasAis()
    const [first, second] = state.players[0].hand
    const target = board(state, 1)[0]!
    const once = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
      targetInstanceId: target.instanceId,
    }).state

    const result = execute(once, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: second!.instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(result.events).toEqual([{ type: 'COMMAND_REJECTED', reason: '这个 AI 已经被干扰过了' }])
    expect(result.state).toBe(once)
  })

  it('替对方打出时走同一套校验，目标是发牌方的对面（也就是我方）', () => {
    // 测试房里点对方手牌就是这条路：DEBUG_PLAY_CARD 只免掉"轮到谁"，目标规则原样生效。
    const state = run(foeHasAis(), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'claude-5-sonnet' },
    ]).state
    const mine = state.players[0].hand.at(-1)!
    const deployed = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: mine.instanceId,
    }).state

    const theirSkill = run(deployed, [
      { type: 'DEBUG_ADD_CARD', player: 1, cardId: 'fixed-answer' },
    ]).state
    const skill = theirSkill.players[1].hand.at(-1)!
    const result = execute(theirSkill, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: skill.instanceId,
      targetInstanceId: board(theirSkill, 0)[0]!.instanceId,
    })

    expect(board(result.state, 0)[0]!.interference).toBe('fixed-answer')
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('不选目标的技能牌行为不变：带了目标也照打不误', () => {
    const state = run(foeHasAis(), [
      { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'one-sentence-answer' },
    ]).state
    const skill = state.players[0].hand.at(-1)!
    const result = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: skill.instanceId,
      targetInstanceId: board(state, 1)[0]!.instanceId,
    })

    // 没有 target 声明的卡不看这个字段：目标不会被标记，事件里也不带它。
    expect(board(result.state, 1)[0]!.interference).toBeUndefined()
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'one-sentence-answer',
        instanceId: skill.instanceId,
      },
    ])
  })
})

describe('英雄抵消 × 要选目标的技能牌', () => {
  /**
   * 「甲满手复读机、乙场上两个 AI」，但**乙带着默认英雄**（格蕾丝·霍珀）。
   * 甲每打一张技能牌，乙的 Debug 就会抵消本局第一张。
   */
  function foeWithHero() {
    // 摆法同上一节的 foeHasAis，只是乙留着默认英雄。
    // 甲在这段摆盘里只打 AI 牌、一张技能都不打，乙的 Debug 才会原封不动留给下面的用例。
    const game = newGame({
      firstPlayer: 1,
      deck0: deckOf('fixed-answer'),
      deck1: deckOf('gpt-3-5'),
      hero0: null,
    })
    return stageTwoFoeAis(game.state, 'gpt-3-5')
  }

  it('被抵消的干扰技能不留下 interfered 标记，那个 AI 之后还能被选中', () => {
    const state = foeWithHero()
    const [first, second] = state.players[0].hand
    const target = board(state, 1)[0]!

    const canceled = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: first!.instanceId,
      targetInstanceId: target.instanceId,
    })
    // 牌照常打出、照常进弃牌堆，作废的只是效果：目标身上什么都不该留下。
    expect(board(canceled.state, 1)[0]!.interference).toBeUndefined()
    expect(canceled.state.players[0].discard.map((c) => c.cardId)).toEqual(['fixed-answer'])
    expect(canceled.state.players[1].heroSkillUsed).toBe(true)
    // 事件序：先出牌（带着本来要打谁），紧跟着抵消。
    expect(canceled.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'fixed-answer',
        instanceId: first!.instanceId,
        targetInstanceId: target.instanceId,
      },
      {
        type: 'SKILL_CANCELED',
        player: 0,
        by: 1,
        heroId: 'grace-hopper',
        cardId: 'fixed-answer',
        instanceId: first!.instanceId,
      },
    ])

    // Debug 一局只发动一次，所以第二张打同一个目标就该真的生效了
    // ——上一张要是错误地留下了标记，这里会被"已经被干扰过了"拒掉。
    const second_ = execute(canceled.state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: second!.instanceId,
      targetInstanceId: target.instanceId,
    })
    expect(board(second_.state, 1)[0]!.interference).toBe('fixed-answer')
    expect(second_.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })
})
