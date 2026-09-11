/**
 * 会真的改动局面的那几张技能牌：核电站（减费）、模型蒸馏（弃手牌换 Token）、
 * 内存紧缺 / 国产替代（清场）、鸡犬升天（全场进化）。
 *
 * 对应 src/engineSkills.ts 的 applySkillEffect 里那几个分支，以及 removeFromBoard。
 * 和 engineSkillsMarks.test.ts 的分界是「改局面」与「只留标记」：
 * 这一组打完之后场上人数、手牌、费用或者卡面身份会变，不是加一枚角标就完事。
 *
 * 「内存紧缺」是引擎里唯一要掷随机的地方，所以这里还顺带守着"同一份状态打两次结果一样、
 * 种子跟着推进"这条确定性（口径见 src/state.ts 的 `GameState.rngSeed`）。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import { effectivePlayCost, execute, getCard } from '../src/index'
import {
  board,
  CATALOG,
  confirmBoth,
  deploy,
  give,
  playSkill,
  rejection,
  SKILL_TEST_TOKENS,
  skillGame,
} from './helpers/engineFixtures'

describe('核电站', () => {
  it('只让打出方后续的牌便宜 1 点，对手照原价付', () => {
    const state = playSkill(skillGame(), 0, 'nuclear-power-station').state
    expect(state.players[0].costReduction).toBe(1)
    expect(state.players[1].costReduction).toBe(0)
    expect(effectivePlayCost(state.players[0], getCard(CATALOG, 'gpt-4o'))).toBe(3)
    expect(effectivePlayCost(state.players[1], getCard(CATALOG, 'gpt-4o'))).toBe(4)

    // 打出方自己后面的牌按减价扣；记账的两处用的是同一个实际费用，
    // 所以结算时的"本轮消耗"也跟着便宜。
    const mine = deploy(state, 0, ['gpt-4o'])
    expect(mine.players[0].tokens).toBe(
      SKILL_TEST_TOKENS - getCard(CATALOG, 'nuclear-power-station').tokenCost - 3,
    )
    expect(mine.players[0].spentThisRound).toBe(
      getCard(CATALOG, 'nuclear-power-station').tokenCost + 3,
    )

    // 对手一点便宜都占不到。
    const foe = deploy(state, 1, ['gpt-4o'])
    expect(foe.players[1].tokens).toBe(SKILL_TEST_TOKENS - 4)
    expect(foe.players[1].spentThisRound).toBe(4)
  })

  it('可以叠加：打两张就减 2', () => {
    const first = playSkill(skillGame(), 0, 'nuclear-power-station').state
    const second = playSkill(first, 0, 'nuclear-power-station').state

    expect(second.players[0].costReduction).toBe(2)
    expect(effectivePlayCost(second.players[0], getCard(CATALOG, 'gpt-4o'))).toBe(2)
    // 第二张自己也吃了第一张的减免：3 点的牌先花 3 再花 2。
    expect(second.players[0].tokens).toBe(SKILL_TEST_TOKENS - 3 - 2)
  })

  it('再怎么减也不会低于 1 点', () => {
    const state = playSkill(
      playSkill(skillGame(), 0, 'nuclear-power-station').state,
      0,
      'nuclear-power-station',
    ).state
    expect(state.players[0].costReduction).toBe(2)
    // GPT-2 卡面就 1 点，减 2 也还是 1，不会变成 0 或负数。
    expect(effectivePlayCost(state.players[0], getCard(CATALOG, 'gpt-2'))).toBe(1)
    const played = deploy(state, 0, ['gpt-2'])
    expect(played.players[0].tokens).toBe(state.players[0].tokens - 1)
  })

  it('进下一轮时减免清零', () => {
    const state = playSkill(skillGame(4), 0, 'nuclear-power-station').state
    const quiz = execute(state, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
    const next = confirmBoth(settle).state

    expect(next.players[0].costReduction).toBe(0)
    expect(effectivePlayCost(next.players[0], getCard(CATALOG, 'gpt-4o'))).toBe(4)
  })
})

describe('模型蒸馏', () => {
  it('弃掉手牌里那张 AI，换来和它印刷费用等量的 Token', () => {
    const state = skillGame()
    const fodder = give(state, 0, 'chatgpt-5-6-sol')
    const result = playSkill(fodder.state, 0, 'model-distillation', fodder.instanceId)

    const player = result.state.players[0]
    expect(player.hand.some((c) => c.instanceId === fodder.instanceId)).toBe(false)
    expect(player.discard.some((c) => c.instanceId === fodder.instanceId)).toBe(true)
    // SKILL_TEST_TOKENS - 2（这张技能牌）+ 5。换来的按印刷费用算，不吃核电站的减费。
    expect(player.tokens).toBe(
      SKILL_TEST_TOKENS -
        getCard(CATALOG, 'model-distillation').tokenCost +
        getCard(CATALOG, 'chatgpt-5-6-sol').tokenCost,
    )
    // 打向手牌的牌不带 targetInstanceId：客户端拿它去战场上找格子会扑空。
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'model-distillation',
        instanceId: player.discard.at(-2)!.instanceId,
      },
      { type: 'CARD_REMOVED', player: 0, instanceId: fodder.instanceId },
    ])
  })

  it('Token 可以顶破上限，下一轮补满时被覆盖', () => {
    const state = skillGame(4)
    const fodder = give(state, 0, 'chatgpt-5-6-sol')
    const rich = playSkill(fodder.state, 0, 'model-distillation', fodder.instanceId).state
    expect(rich.players[0].tokens).toBeGreaterThan(rich.players[0].tokenMax)

    const quiz = execute(rich, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
    const next = confirmBoth(settle).state
    expect(next.players[0].tokens).toBe(next.players[0].tokenMax)
  })

  it('目标只能是手牌里的 AI 牌', () => {
    const state = skillGame()
    const skill = give(state, 0, 'one-sentence-answer')
    // 技能牌不行（这一条顺带挡住了"拿蒸馏自己当目标"）。
    expect(rejection(playSkill(skill.state, 0, 'model-distillation', skill.instanceId))).toBe(
      '目标必须是你手牌里的一张 AI 牌',
    )
    // 场上的 AI 也不行：它要的是手牌实例。
    const deployed = deploy(state, 0, ['gpt-2'])
    expect(
      rejection(playSkill(deployed, 0, 'model-distillation', board(deployed, 0)[0]!.instanceId)),
    ).toBe('目标必须是你手牌里的一张 AI 牌')
    expect(rejection(playSkill(state, 0, 'model-distillation'))).toBe('这张技能牌要先指定目标')
  })
})

describe('内存紧缺', () => {
  it('向上取整保留一半：3 个留 2 个，落选的进弃牌堆', () => {
    const state = deploy(skillGame(), 0, ['gpt-2', 'gpt-2', 'gpt-2'])
    const before = board(state, 0).map((a) => a.instanceId)
    const result = playSkill(state, 1, 'memory-shortage')

    const after = board(result.state, 0).map((a) => a.instanceId)
    expect(after).toHaveLength(2)
    // 留下的保持原来的先后顺序，客户端的战场格子才不用整排重排。
    expect(after).toEqual(before.filter((id) => after.includes(id)))

    const removed = result.events.filter((e) => e.type === 'AI_REMOVED')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toEqual({
      type: 'AI_REMOVED',
      instanceId: before.find((id) => !after.includes(id)),
      owner: 0,
      cardId: 'gpt-2',
      by: 'memory-shortage',
    })
    expect(result.state.players[0].discard.map((c) => c.instanceId)).toContain(
      removed[0]!.instanceId,
    )
  })

  it('场上只有 1 个时一个都不清（ceil(1/2) = 1）', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const result = playSkill(state, 1, 'memory-shortage')
    expect(board(result.state, 0)).toHaveLength(1)
    expect(result.events.some((e) => e.type === 'AI_REMOVED')).toBe(false)
  })

  it('空场也打得出去，什么都不发生', () => {
    const result = playSkill(skillGame(), 0, 'memory-shortage')
    expect(rejection(result)).toBeUndefined()
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('同一份状态打两次得到同一批幸存者，种子跟着推进', () => {
    // 随机数从状态里的种子起，所以联机两端各自重放同一条指令不会分叉。
    const state = deploy(skillGame(), 0, ['gpt-2', 'gpt-2', 'gpt-2'])
    const first = playSkill(state, 1, 'memory-shortage')
    const second = playSkill(state, 1, 'memory-shortage')

    expect(board(first.state, 0).map((a) => a.instanceId)).toEqual(
      board(second.state, 0).map((a) => a.instanceId),
    )
    expect(first.state.rngSeed).not.toBe(state.rngSeed)
    // 种子推进过了，所以接着再打一张清的不一定是同一批（这里只要求它确实换了个数）。
    expect(playSkill(first.state, 1, 'memory-shortage').state.rngSeed).not.toBe(first.state.rngSeed)
  })

  it('双方各清各的一半', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'gpt-2']), 1, ['gpt-2', 'gpt-2'])
    const result = playSkill(state, 0, 'memory-shortage')
    expect(board(result.state, 0)).toHaveLength(1)
    expect(board(result.state, 1)).toHaveLength(1)
  })
})

describe('国产替代', () => {
  it('双方场上没有国产标签的全部罚下，包括打出方自己的', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'qwen']), 1, ['doubao', 'gemini'])
    const doomed = [board(state, 0)[0]!, board(state, 1)[1]!]
    const result = playSkill(state, 0, 'domestic-substitution')

    expect(board(result.state, 0).map((a) => a.cardId)).toEqual(['qwen'])
    expect(board(result.state, 1).map((a) => a.cardId)).toEqual(['doubao'])
    // 事件按座位号顺序发：先甲的，再乙的。
    expect(result.events.filter((e) => e.type === 'AI_REMOVED')).toEqual([
      {
        type: 'AI_REMOVED',
        instanceId: doomed[0]!.instanceId,
        owner: 0,
        cardId: 'gpt-2',
        by: 'domestic-substitution',
      },
      {
        type: 'AI_REMOVED',
        instanceId: doomed[1]!.instanceId,
        owner: 1,
        cardId: 'gemini',
        by: 'domestic-substitution',
      },
    ])
    expect(result.state.players[0].discard.map((c) => c.cardId)).toContain('gpt-2')
  })

  it('全场都是国产时打空也不拒', () => {
    const state = deploy(skillGame(), 0, ['qwen', 'doubao'])
    const result = playSkill(state, 0, 'domestic-substitution')
    expect(rejection(result)).toBeUndefined()
    expect(board(result.state, 0)).toHaveLength(2)
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })
})

describe('鸡犬升天', () => {
  it('双方场上可进化的各升一级，链尾原地不动', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'chatgpt-5-6-sol']), 1, [
      'claude-5-sonnet',
    ])
    const evolving = board(state, 0)[0]!
    const theirs = board(state, 1)[0]!
    const result = playSkill(state, 1, 'rising-tide')

    expect(board(result.state, 0).map((a) => a.cardId)).toEqual(['gpt-3-5', 'chatgpt-5-6-sol'])
    expect(board(result.state, 1).map((a) => a.cardId)).toEqual(['claude-fable-5'])
    expect(result.events.filter((e) => e.type === 'AI_TRANSFORMED')).toEqual([
      {
        type: 'AI_TRANSFORMED',
        instanceId: evolving.instanceId,
        owner: 0,
        fromCardId: 'gpt-2',
        toCardId: 'gpt-3-5',
      },
      {
        type: 'AI_TRANSFORMED',
        instanceId: theirs.instanceId,
        owner: 1,
        fromCardId: 'claude-5-sonnet',
        toCardId: 'claude-fable-5',
      },
    ])
  })

  it('换的只是卡面身份：实例 id 和身上的本轮标记都留着', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const hit = playSkill(state, 1, 'fixed-answer', mine.instanceId).state
    const result = playSkill(hit, 1, 'rising-tide')

    expect(board(result.state, 0)[0]).toEqual({
      instanceId: mine.instanceId,
      cardId: 'gpt-3-5',
      owner: 0,
      interference: 'fixed-answer',
      // 换脸自己也记一笔：本轮谁把它变成 GPT-3.5 的，只剩这一处看得出来。
      affectedBy: ['fixed-answer', 'rising-tide'],
      // 跨轮留着的那一笔，界面靠它常挂「已进化」角标。
      evolvedTimes: 1,
    })
  })

  it('连打两张就顺着链子升两级，进化次数也记两次', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const once = playSkill(state, 1, 'rising-tide').state
    const twice = playSkill(once, 1, 'rising-tide').state
    expect(board(twice, 0).map((a) => a.cardId)).toEqual(['gpt-4o'])
    expect(board(twice, 0)[0]?.evolvedTimes).toBe(2)
  })

  it('升不动的单位不记进化次数', () => {
    const state = deploy(skillGame(), 0, ['chatgpt-5-6-sol'])
    const after = playSkill(state, 1, 'rising-tide').state
    expect(board(after, 0)[0]?.evolvedTimes).toBeUndefined()
  })
})
