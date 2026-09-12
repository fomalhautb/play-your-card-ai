/**
 * 在场上单位或玩家身上留下**本轮标记**的那几张技能牌：
 * 复读机 / 黑白颠倒（干扰）、玉净瓶（解干扰）、保送、金钟罩。
 *
 * 对应 src/engineSkills.ts 的 applySkillEffect 里那几个分支，以及 markAffected /
 * unmarkAffected 两个小工具。它们的共同点是**不清场也不改费用**，只往状态上写一笔标记，
 * 而且进下一轮时一起被 engineRound.ts 的 confirmRound 清掉（清干净没有另有用例守着）。
 *
 * 会清场、改费用、动手牌的那几张在 engineSkillsEffects.test.ts；
 * "目标选得对不对"那套校验在 engineSkillsTarget.test.ts。
 *
 * 整套测试的分工见 test/README.md，共用夹具在 helpers/engineFixtures.ts。
 */

import { describe, expect, it } from 'vitest'
import { effectivePlayCost, execute, getCard } from '../src/index'
import {
  answersFor,
  board,
  CATALOG,
  confirmBoth,
  deckOf,
  deploy,
  give,
  newGame,
  playSkill,
  rejection,
  SKILL_TEST_TOKENS,
  skillGame,
  toRound,
} from './helpers/engineFixtures'

describe('干扰：复读机与黑白颠倒', () => {
  /** 甲场上一个 AI，等着乙来干扰。 */
  function foeAi() {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    return { state, target: board(state, 0)[0]! }
  }

  it('命中后记的是打中它的那张牌，两张干扰各记各的', () => {
    const { state, target } = foeAi()
    const reversed = playSkill(state, 1, 'black-white-reversal', target.instanceId)
    expect(board(reversed.state, 0)[0]!.interference).toBe('black-white-reversal')

    const repeated = playSkill(state, 1, 'fixed-answer', target.instanceId)
    expect(board(repeated.state, 0)[0]!.interference).toBe('fixed-answer')
  })

  it('一个 AI 只挂得住一种干扰：挂着复读机的也挡住黑白颠倒', () => {
    // 两张牌共用 interference 这一个格子，所以"已经被干扰过了"这条对它们是通用的。
    const { state, target } = foeAi()
    const once = playSkill(state, 1, 'fixed-answer', target.instanceId).state
    expect(rejection(playSkill(once, 1, 'black-white-reversal', target.instanceId))).toBe(
      '这个 AI 已经被干扰过了',
    )
  })
})

describe('玉净瓶', () => {
  /** 甲场上一个 AI，已经被乙的复读机干扰。 */
  function interferedMine() {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    return playSkill(state, 1, 'fixed-answer', mine.instanceId).state
  }

  it('把己方 AI 身上的干扰摘掉，事件带上目标 id', () => {
    const state = interferedMine()
    const mine = board(state, 0)[0]!
    const result = playSkill(state, 0, 'jade-purification-vase', mine.instanceId)

    expect(board(result.state, 0)[0]!.interference).toBeUndefined()
    // 摘的是效果，单位本身一动不动。
    expect(board(result.state, 0)[0]!.instanceId).toBe(mine.instanceId)
    expect(result.events).toEqual([
      {
        type: 'SKILL_PLAYED',
        player: 0,
        cardId: 'jade-purification-vase',
        instanceId: result.state.players[0].discard.at(-1)!.instanceId,
        targetInstanceId: mine.instanceId,
      },
    ])
  })

  it('目标身上没有可移除的效果时被拒', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    expect(rejection(playSkill(state, 0, 'jade-purification-vase', mine.instanceId))).toBe(
      '这个 AI 身上没有可以移除的效果',
    )
  })

  it('目标是对方场上的 AI 时被拒（它只管己方）', () => {
    const state = interferedMine()
    const foe = deploy(state, 1, ['gpt-2'])
    expect(
      rejection(playSkill(foe, 0, 'jade-purification-vase', board(foe, 1)[0]!.instanceId)),
    ).toBe('目标必须是你自己场上的 AI')
  })

  it('展示用的那一份跟着换：撤掉复读机，记上玉净瓶自己', () => {
    // 不撤的话小卡会一直挂着「复读中」，而这个单位其实已经干净了（见 state.ts 的 affectedBy）。
    const state = interferedMine()
    const mine = board(state, 0)[0]!
    const result = playSkill(state, 0, 'jade-purification-vase', mine.instanceId)
    expect(board(result.state, 0)[0]!.affectedBy).toEqual(['jade-purification-vase'])
  })

  it('摘干净之后本轮还能再被干扰一次', () => {
    // 干扰的判据是"身上现在有没有"，不是"这一轮被打过没有"，所以摘掉就等于回到没被打过。
    const state = interferedMine()
    const mine = board(state, 0)[0]!
    const cleaned = playSkill(state, 0, 'jade-purification-vase', mine.instanceId).state
    const again = playSkill(cleaned, 1, 'black-white-reversal', mine.instanceId)
    expect(board(again.state, 0)[0]!.interference).toBe('black-white-reversal')
  })
})

describe('保送', () => {
  it('标记己方场上的 AI，事件带上目标 id', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const result = playSkill(state, 0, 'safe-pass', mine.instanceId)

    expect(board(result.state, 0)[0]!.safePassed).toBe(true)
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('已经被保送的 AI 不能再被选中', () => {
    const state = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const once = playSkill(state, 0, 'safe-pass', mine.instanceId).state
    expect(rejection(playSkill(once, 0, 'safe-pass', mine.instanceId))).toBe('这个 AI 已经被保送了')
  })

  it('目标是对方场上的 AI 时被拒', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2']), 1, ['gpt-2'])
    expect(rejection(playSkill(state, 0, 'safe-pass', board(state, 1)[0]!.instanceId))).toBe(
      '目标必须是你自己场上的 AI',
    )
  })

  /**
   * 摆一个"甲两个 AI 全答错、其中一个被保送；乙一个 AI 答对且花得更多"的结算。
   *
   * 乙那张刻意用最贵的 ChatGPT 5.6 Sol：这样两种计分口径会给出相反的结果——
   * 按 results 数答对数是 [0, 1]（乙拿分），按"罚下之后场上还剩几个"却是 [1, 1] 打平、
   * 再比消耗反而是甲拿分。用例守的就是这个差别。
   */
  function safePassedSettle() {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2', 'gpt-2']), 1, ['chatgpt-5-6-sol'])
    const saved = board(state, 0)[0]!
    const passed = playSkill(state, 0, 'safe-pass', saved.instanceId).state
    const quiz = execute(passed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const wrong = board(quiz, 0).map((a) => a.instanceId)
    return {
      saved,
      quiz,
      result: execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz, wrong) }),
    }
  }

  it('答错也留在场上，发 AI_SAFE_PASSED 而不是 AI_ELIMINATED', () => {
    const { saved, result } = safePassedSettle()

    expect(board(result.state, 0).map((a) => a.instanceId)).toEqual([saved.instanceId])
    expect(result.events).toContainEqual({
      type: 'AI_SAFE_PASSED',
      instanceId: saved.instanceId,
      owner: 0,
    })
    // 被保送的那个一条罚下事件都没有；同排没被保送的那个照常罚下。
    expect(
      result.events.filter((e) => e.type === 'AI_ELIMINATED').map((e) => e.instanceId),
    ).not.toContain(saved.instanceId)
    expect(result.events.filter((e) => e.type === 'AI_ELIMINATED')).toHaveLength(1)
    expect(result.state.players[0].discard.some((c) => c.instanceId === saved.instanceId)).toBe(
      false,
    )
  })

  it('保送留场的仍然算答错，不给计分注水', () => {
    const { result } = safePassedSettle()
    expect(result.events.find((e) => e.type === 'ROUND_SCORED')).toMatchObject({
      correctCounts: [0, 1],
      gains: [0, 1],
      verdict: 'more-correct',
    })
  })

  it('进下一轮时保送标记清掉，展示用的那一份也一起清', () => {
    const state = deploy(skillGame(4), 0, ['gpt-2'])
    const mine = board(state, 0)[0]!
    const passed = playSkill(state, 0, 'safe-pass', mine.instanceId).state
    expect(board(passed, 0)[0]!.affectedBy).toEqual(['safe-pass'])
    const quiz = execute(passed, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    const next = confirmBoth(settle).state

    expect(next.round).toBe(5)
    expect(board(next, 0)[0]!.safePassed).toBeUndefined()
    // 角标只活本轮：新一轮开始时这个单位身上不该还留着上一轮那几张牌。
    expect(board(next, 0)[0]!.affectedBy).toBeUndefined()
  })
})

describe('金钟罩', () => {
  it('打出后这一方挂上罩子，无目标', () => {
    const state = skillGame()
    const result = playSkill(state, 0, 'golden-bell-shield')
    expect(result.state.players[0].shielded).toBe(true)
    expect(result.state.players[1].shielded).toBeUndefined()
    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED'])
  })

  it('对方的干扰技能选不中被罩那一方的 AI', () => {
    const state = deploy(skillGame(), 1, ['gpt-2'])
    const shielded = playSkill(state, 1, 'golden-bell-shield').state
    const theirs = board(shielded, 1)[0]!
    expect(rejection(playSkill(shielded, 0, 'fixed-answer', theirs.instanceId))).toBe(
      '对方金钟罩生效中，技能牌影响不到他的 Agent',
    )
    expect(board(shielded, 1)[0]!.interference).toBeUndefined()
  })

  it('自己也打不出玉净瓶/保送这类作用于自己场上单位的牌', () => {
    // 口径是字面全挡：罩着的时候连对自己有利的效果也一起挡在外面。
    // 先让乙干扰一下甲的 AI，玉净瓶才有个合法目标可选（不然会先被"没有可移除的效果"拦掉）。
    const base = deploy(skillGame(), 0, ['gpt-2'])
    const mine = board(base, 0)[0]!
    const hit = playSkill(base, 1, 'fixed-answer', mine.instanceId).state
    const shielded = playSkill(hit, 0, 'golden-bell-shield').state
    // 12 - 1（AI）- 3（金钟罩）= 8，下面两张都还买得起，被拒的原因只可能是罩子。
    expect(shielded.players[0].tokens).toBe(SKILL_TEST_TOKENS - 1 - 3)

    const blocked = '金钟罩生效中，本轮技能牌也影响不到你自己场上的 AI'
    expect(rejection(playSkill(shielded, 0, 'jade-purification-vase', mine.instanceId))).toBe(
      blocked,
    )
    expect(rejection(playSkill(shielded, 0, 'safe-pass', mine.instanceId))).toBe(blocked)
  })

  it('罩着照样能打模型蒸馏：它弃的是手牌，够不着场上的 AI', () => {
    const shielded = playSkill(skillGame(), 0, 'golden-bell-shield').state
    const withAi = give(shielded, 0, 'gpt-4o')
    const result = playSkill(withAi.state, 0, 'model-distillation', withAi.instanceId)
    expect(rejection(result)).toBeUndefined()
    // 12 - 3（金钟罩）- 2（蒸馏）+ 4（gpt-4o 的印刷费用）= 11
    expect(result.state.players[0].tokens).toBe(
      SKILL_TEST_TOKENS -
        getCard(CATALOG, 'golden-bell-shield').tokenCost -
        getCard(CATALOG, 'model-distillation').tokenCost +
        getCard(CATALOG, 'gpt-4o').tokenCost,
    )
    expect(result.state.players[0].hand.some((c) => c.instanceId === withAi.instanceId)).toBe(false)
  })

  it('第二张金钟罩被拒（罩子自己是全挡口径唯一的例外）', () => {
    // 两张金钟罩要 14 点，比这批用例发的 SKILL_TEST_TOKENS 还多，得先用模型蒸馏把额度顶上去。
    // 费用那道闸排在这条检查之前（见 playCard），钱不够的话报的会是"Token 不够"。
    const state = skillGame()
    const fodder = give(state, 0, 'chatgpt-5-6-sol')
    const rich = playSkill(fodder.state, 0, 'model-distillation', fodder.instanceId).state
    const shielded = playSkill(rich, 0, 'golden-bell-shield').state
    expect(shielded.players[0].tokens).toBeGreaterThanOrEqual(
      getCard(CATALOG, 'golden-bell-shield').tokenCost,
    )
    expect(rejection(playSkill(shielded, 0, 'golden-bell-shield'))).toBe('本轮已经有金钟罩了')
  })

  it('群体技能跳过被罩的一方，另一方照常结算', () => {
    const state = deploy(deploy(skillGame(), 0, ['gpt-2']), 1, ['gpt-2'])
    const shielded = playSkill(state, 0, 'golden-bell-shield').state
    const result = playSkill(shielded, 1, 'domestic-substitution')

    // 两个都是非国产，但只有没被罩的乙自己那个被清了。
    expect(board(result.state, 0)).toHaveLength(1)
    expect(board(result.state, 1)).toHaveLength(0)
    expect(result.events.filter((e) => e.type === 'AI_REMOVED').map((e) => e.owner)).toEqual([1])
  })

  it('罩着照样吃自己核电站的减费：减的是出牌费用，不是场上单位', () => {
    const state = playSkill(skillGame(), 0, 'nuclear-power-station').state
    const shielded = playSkill(state, 0, 'golden-bell-shield').state
    expect(shielded.players[0].costReduction).toBe(1)
    expect(effectivePlayCost(shielded.players[0], getCard(CATALOG, 'gpt-4o'))).toBe(
      getCard(CATALOG, 'gpt-4o').tokenCost - 1,
    )
    // 核电站自己那一张按原价付，之后的金钟罩才吃到减价。
    expect(shielded.players[0].tokens).toBe(
      SKILL_TEST_TOKENS -
        getCard(CATALOG, 'nuclear-power-station').tokenCost -
        (getCard(CATALOG, 'golden-bell-shield').tokenCost - 1),
    )
  })

  it('被英雄技能抵消时罩子不生效', () => {
    // 抵消的判定排在效果之前，所以这一整套都不该留下痕迹（其余技能牌同理）。
    const game = newGame({ deck0: deckOf('gpt-2'), deck1: deckOf('gpt-2'), hero0: null })
    const state = toRound(game.state, 5)
    const result = playSkill(state, 0, 'golden-bell-shield')

    expect(result.events.map((e) => e.type)).toEqual(['SKILL_PLAYED', 'SKILL_CANCELED'])
    expect(result.state.players[0].shielded).toBeUndefined()
  })

  it('进下一轮时罩子撤掉', () => {
    const shielded = playSkill(skillGame(4), 0, 'golden-bell-shield').state
    const quiz = execute(shielded, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: [] }).state
    expect(confirmBoth(settle).state.players[0].shielded).toBeUndefined()
  })
})
