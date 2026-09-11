/**
 * 教学对战的内容自检（搬自旧版 `legacy-client/test/tutorial.test.ts` 的「教学内容自检」一段）。
 *
 * 守的是「剧本为什么成立」：题和牌都是照那张真实模型回答表挑的，
 * 换一张就可能让某一轮的对错翻过来，而主线那条测试报出来只是一句「比分不对」。
 * 这里按格子对账，直接指出是哪一轮、哪张卡、答对还是答错。
 */

import { CARD_POOL, CARDS, HEROES, QUESTION_POOL, scriptedAnswers } from '@ai-duel/content'
import type { CardId } from '@ai-duel/core'
import { INITIAL_TOKEN_MAX, TOKEN_MAX_GROWTH } from '@ai-duel/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TUTORIAL_CARDS,
  TUTORIAL_FOE_DECK,
  TUTORIAL_FOE_HERO,
  TUTORIAL_FOE_OPENING_HAND,
  TUTORIAL_FOE_PLAYS,
  TUTORIAL_PLAYER_DECK,
  TUTORIAL_PLAYER_DRAW_ORDER,
  TUTORIAL_PLAYER_OPENING_HAND,
  TUTORIAL_QUESTIONS,
  tutorialCardCost,
} from '../src/tutorial/content'
import { TUTORIAL_HERO } from '../src/tutorial/heroSteps'
import { FOE, flush, PLAYER, start, stateOf } from './helpers/tutorialRun'

/** 这张卡是 AI 还是技能。查 content 的卡表而不是 core 的 `getCard`，理由同 tutorialCardCost。 */
function kindOf(cardId: CardId): string {
  return CARDS[cardId]?.kind ?? 'unknown'
}

describe('教学内容自检', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('双方牌组各 20 张，每张卡至多两份', () => {
    for (const deck of [TUTORIAL_PLAYER_DECK, TUTORIAL_FOE_DECK]) {
      expect(deck).toHaveLength(20)
      const counts = new Map<CardId, number>()
      for (const cardId of deck) counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
      for (const [cardId, count] of counts) {
        expect(count, `${cardId} 放了 ${count} 份`).toBeLessThanOrEqual(2)
      }
    }
  })

  // 教学牌组必须整副都在 CARD_POOL 里，没有例外：第 3 轮玩家可以自由出牌
  //（步骤表那一步 playableCards 是 null），混进一张卡池外的牌——「即将上线」的技能牌，
  // 或者 GPT-2、文心一言那种调不到模型的 AI——玩家就能把它打上牌桌，
  // 学完回到牌组页却发现那张是灰的、自己拼不出这副牌。
  // core 不校验牌组内容，教学 driver 也直接把这两副牌塞给引擎，所以只有这条测试守着。
  it('教学双方牌组里的每张牌都在已开放的卡池里', () => {
    for (const deck of [TUTORIAL_PLAYER_DECK, TUTORIAL_FOE_DECK]) {
      for (const cardId of deck) {
        expect(CARD_POOL, `${cardId} 不在卡池里`).toContain(cardId)
      }
    }
  })

  // 教学局的每一步都是照脚本对好的，对手身上多一条会生效的技能就可能把它顶歪
  //（霍珀的 Debug 会抵消玩家第 2 轮那张教学技能牌，阿达的 +2 会让下面那本 Token 账对不上）。
  // 挑一位 comingSoon 的英雄就等于「这一位在引擎里什么都不做」，是最省心的做法；
  // 等这三位陆续实装、这条测试再也找不到人选时，得回来给教学局另想一个不干扰脚本的对手。
  it('教学对手的英雄技能没有实装，不会掺和进脚本', () => {
    expect(HEROES[TUTORIAL_FOE_HERO].comingSoon).toBe(true)
  })

  // 反过来的一半：教程说「英雄自带独特技能」，引导玩家去选的那位必须真有技能，
  // 而且不能是被选英雄页置灰的那三位之一——引导层的高亮会正好圈在一张点不开的卡上。
  it('教程引导玩家选的英雄技能已实装，选英雄页不会把她置灰', () => {
    expect(HEROES[TUTORIAL_HERO].comingSoon).toBeUndefined()
  })

  it('起手 5 张正好是教学点名要用的那几张', () => {
    const run = start()
    flush()
    const state = stateOf(run.driver)
    expect(state.players[PLAYER].hand.map((item) => item.cardId)).toEqual(
      TUTORIAL_PLAYER_OPENING_HAND,
    )
    expect(state.players[FOE].hand.map((item) => item.cardId)).toEqual(TUTORIAL_FOE_OPENING_HAND)
    // 教程点名的几张牌一张都不能少，否则前两轮的强制引导会指向一张不存在的牌。
    for (const cardId of [
      TUTORIAL_CARDS.firstAi,
      TUTORIAL_CARDS.skill,
      ...TUTORIAL_CARDS.optionalAi,
    ]) {
      expect(TUTORIAL_PLAYER_OPENING_HAND).toContain(cardId)
    }
  })

  it('三轮的对错都是从真实模型回答表里查出来的', () => {
    for (const question of TUTORIAL_QUESTIONS) {
      expect(QUESTION_POOL, `${question.id} 不在正式题库里`).toContain(question)
    }

    TUTORIAL_FOE_PLAYS.forEach((plays, index) => {
      const question = TUTORIAL_QUESTIONS[index]
      if (question === undefined) throw new Error(`第 ${index + 1} 轮没有题目`)
      const foeCard = plays[0]
      if (foeCard === undefined) throw new Error(`第 ${index + 1} 轮对手没有出牌`)

      // 玩家场上那张 AI 从第 1 轮活到底，三轮都要答对，那三分全靠它。
      const [mine] = scriptedAnswers(question, [
        { instanceId: 'mine', cardId: TUTORIAL_CARDS.firstAi, owner: PLAYER },
      ])
      expect(mine?.correct, `第 ${index + 1} 轮 ${TUTORIAL_CARDS.firstAi} 该答对`).toBe(true)

      // 对手那张要答错。第 2 轮是靠复读机把它从「答对」改成「答香蕉」，所以两档都要对上：
      // 没被干扰时答对（不然那张技能牌就没改变任何结果，这一课当场落空），干扰后答错。
      const interfered = index === 1
      const [theirs] = scriptedAnswers(question, [
        {
          instanceId: 'theirs',
          cardId: foeCard,
          owner: FOE,
          ...(interfered ? { interference: 'fixed-answer' as const } : {}),
        },
      ])
      expect(theirs?.correct, `第 ${index + 1} 轮 ${foeCard} 该答错`).toBe(false)
      if (interfered) {
        const [clean] = scriptedAnswers(question, [
          { instanceId: 'theirs', cardId: foeCard, owner: FOE },
        ])
        expect(clean?.correct, `${foeCard} 没被干扰时本该答对`).toBe(true)
        expect(theirs?.answer, '被复读机干扰之后该改口答香蕉').toContain('香蕉')
      }
    })
  })

  // 第 3 轮是放手轮：玩家想派谁就派谁，而回答查的是真实模型表。
  // 手上留着一张会答错那道题的 AI，玩家照着「随便派」派出去就会当场看着它被罚下——
  // 教程刚教完「答错要下场」，这时候演一遍只会让人以为自己做错了。
  it('第 3 轮玩家摸得到的每一张 AI 都答得对那道题', () => {
    const question = TUTORIAL_QUESTIONS[2]
    if (question === undefined) throw new Error('教学局没有第 3 道题')
    for (const cardId of new Set(TUTORIAL_PLAYER_DRAW_ORDER)) {
      if (kindOf(cardId) !== 'ai') continue
      const [answer] = scriptedAnswers(question, [{ instanceId: 'x', cardId, owner: PLAYER }])
      expect(answer?.correct, `${cardId} 在第 3 轮那道题上会答错`).toBe(true)
    }
  })

  it('对手每一轮的脚本都付得起 Token', () => {
    TUTORIAL_FOE_PLAYS.forEach((plays, index) => {
      const limit = INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH * index
      const cost = plays.reduce((sum, cardId) => sum + tutorialCardCost(cardId), 0)
      expect(cost, `第 ${index + 1} 轮对手要花 ${cost} 点`).toBeLessThanOrEqual(limit)
    })
  })

  it('第 2 轮双方最贵的那条路都买得起', () => {
    // 教学第 2 轮强制打复读机，之后按 optionalAi 还可能再增派一张（现在是空的）。
    // 加起来必须在当轮额度内，否则玩家照着引导点下去会被引擎回一句「Token 不够」，教程当场卡住。
    // Math.max 补一个 0 兜底：名单空着时展开成 Math.max() 会得到 -Infinity。
    const optionalCosts = TUTORIAL_CARDS.optionalAi.map(tutorialCardCost)
    const playerMax = tutorialCardCost(TUTORIAL_CARDS.skill) + Math.max(0, ...optionalCosts)
    expect(playerMax).toBeLessThanOrEqual(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
    // 对手那一轮也得付得起。
    const foeSpend = (TUTORIAL_FOE_PLAYS[1] ?? []).reduce(
      (sum, cardId) => sum + tutorialCardCost(cardId),
      0,
    )
    expect(foeSpend).toBeLessThanOrEqual(INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH)
  })

  it('第 2 轮一张增派的 AI 都不放行', () => {
    // 空名单的理由见 TUTORIAL_CARDS.optionalAi：原来放这里的 1 费 GPT-2 调不到模型、
    // 已经不在卡池里，而这一步要教的是「技能真的会改结果」，不该再塞一个可选动作分散注意力。
    // 它**不是** Token 对账逼出来的——第 2 轮那一分靠「只有玩家答对」拿到，和消耗无关。
    expect(TUTORIAL_CARDS.optionalAi).toEqual([])
    // 哪天想把这个可选动作加回来，唯一那条硬约束在这里守着：打完复读机剩下的额度得买得起它。
    const left = INITIAL_TOKEN_MAX + TOKEN_MAX_GROWTH - tutorialCardCost(TUTORIAL_CARDS.skill)
    for (const cardId of TUTORIAL_CARDS.optionalAi) {
      expect(kindOf(cardId)).toBe('ai')
      expect(tutorialCardCost(cardId)).toBeLessThanOrEqual(left)
    }
  })
})
