/**
 * 构筑页卡池的用例，整批从旧客户端搬过来（`legacy-client/test/deckCardPool.test.ts`
 * 和 `deckFactions.test.ts`），是第 28 条唯一原样保留的一份测试。
 *
 * 搬家时改了三处：
 * 1. 查卡定义从旧的全局 `getCard(id)` 换成 content 自己的 `CARDS`（新的 `getCard` 要一份 catalog）；
 * 2. 「阵营归堆」「卡池筛选」原来在两个文件里，这里并成一份——它们查的是同一张卡表；
 * 3. 旧版还有一条「卡背文案不会印成『还没实装』」，那读的是 legacy 的 `ui/cardText.ts`，
 *    正式版的卡背文案是第 29 条的事，等那边落地再补。
 */

import type { CardId, SkillCard } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARD_IDS,
  blockedReasonOf,
  CARD_POOL,
  CARDS,
  COMING_SOON_SKILL_CARD_IDS,
  DECK_DISPLAY_CARD_IDS,
  DECK_FACTIONS,
  type DeckFaction,
  factionForAi,
  filterDeckCards,
  isAiCard,
  OPEN_SKILL_CARD_IDS,
  PLAYABLE_AI_CARD_IDS,
  UNAVAILABLE_AI_CARD_IDS,
} from '../src/index'

/**
 * 五张要选目标的技能牌各自打谁。
 *
 * 抄自旧版那份同名 fixture：它守的是「界面上那条选目标的路和卡定义对得上」——
 * 少一档、改一档，构筑页和对局里亮出来的候选就会和引擎判的不一致。
 */
const TARGETED_SKILLS: Record<CardId, SkillCard['target']> = {
  'fixed-answer': 'foe-ai',
  'black-white-reversal': 'foe-ai',
  'jade-purification-vase': 'own-affected-ai',
  'safe-pass': 'own-ai',
  'model-distillation': 'own-hand-ai',
}

describe('阵营归堆', () => {
  it('18 张 AI 每张都落进某一个药丸，没有卡掉在筛选外面', () => {
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    const ids = new Set<DeckFaction>(DECK_FACTIONS.map((one) => one.id))
    for (const cardId of AI_MODEL_CARD_IDS) {
      expect(ids.has(factionForAi(cardId)), `${cardId} 没有归堆`).toBe(true)
    }
  })

  it('按前缀分堆的四家各归各家', () => {
    const of = (faction: DeckFaction) =>
      AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === faction)
    expect(of('gpt')).toEqual(['gpt-2', 'gpt-3-5', 'gpt-4o', 'chatgpt-5-6-sol'])
    expect(of('claude')).toEqual(['claude-5-sonnet', 'claude-fable-5'])
    expect(of('kimi')).toEqual(['kimi-k2-6', 'kimi-k3'])
    expect(of('deepseek')).toEqual(['deepseek-r1', 'deepseek-v4'])
  })

  it('不属于上面四家的单张模型全部兜底进「其他」', () => {
    expect(AI_MODEL_CARD_IDS.filter((id) => factionForAi(id) === 'other')).toEqual([
      'gemini',
      'qwen',
      'doubao',
      'glm-5',
      'minimax',
      'yuanbao',
      'grok',
      'wenxin-yiyan',
    ])
  })
})

describe('卡池筛选', () => {
  const skillIds = CARD_POOL.filter((id) => CARDS[id]?.kind === 'skill')

  it('不选阵营时按种类筛，「全部」就是整个卡池', () => {
    expect(filterDeckCards(CARD_POOL, 'all', null)).toEqual(CARD_POOL)
    expect(filterDeckCards(CARD_POOL, 'ai', null)).toEqual(PLAYABLE_AI_CARD_IDS)
    expect(filterDeckCards(CARD_POOL, 'skill', null)).toEqual(skillIds)
  })

  it('阵营会把 AI 牌收窄到那一家', () => {
    // 没有 gpt-2：它调不到模型，不在卡池里。
    expect(filterDeckCards(CARD_POOL, 'ai', 'gpt')).toEqual([
      'gpt-3-5',
      'gpt-4o',
      'chatgpt-5-6-sol',
    ])
    for (const option of DECK_FACTIONS) {
      const shown = filterDeckCards(CARD_POOL, 'ai', option.id)
      expect(shown.length, `${option.id} 一张卡都没有`).toBeGreaterThan(0)
      for (const cardId of shown) expect(factionForAi(cardId)).toBe(option.id)
    }
  })

  it('技能牌不受阵营筛选影响：选了阵营，技能牌照样一张不少', () => {
    for (const option of DECK_FACTIONS) {
      expect(filterDeckCards(CARD_POOL, 'skill', option.id)).toEqual(skillIds)
      const all = filterDeckCards(CARD_POOL, 'all', option.id)
      expect(all.filter((id) => CARDS[id]?.kind === 'skill')).toEqual(skillIds)
      expect(all.filter((id) => CARDS[id]?.kind === 'ai')).toEqual(
        filterDeckCards(CARD_POOL, 'ai', option.id),
      )
    }
  })
})

describe('构筑页卡池', () => {
  it('卡池里每张牌都查得到定义，所以拼出来的牌组可以直接开局', () => {
    expect(CARD_POOL.length).toBeGreaterThan(0)
    for (const cardId of CARD_POOL) expect(CARDS[cardId], `${cardId} 没有定义`).toBeDefined()
  })

  it('卡池只有 AI 和技能两类，正好对上页面的两个种类页签', () => {
    const counted = CARD_POOL.filter(
      (id) => CARDS[id]?.kind === 'ai' || CARDS[id]?.kind === 'skill',
    )
    expect(counted).toHaveLength(CARD_POOL.length)
  })

  it('卡池 = 调得到模型的 16 张 AI + 已开放的 10 张技能牌', () => {
    expect(CARD_POOL).toEqual([...PLAYABLE_AI_CARD_IDS, ...OPEN_SKILL_CARD_IDS])
    expect(AI_MODEL_CARD_IDS).toHaveLength(18)
    expect(PLAYABLE_AI_CARD_IDS).toHaveLength(16)
    expect(OPEN_SKILL_CARD_IDS).toHaveLength(10)
  })

  it('要摆的灰卡有两批：调不到模型的 2 张 AI + 「即将上线」的 14 张技能牌', () => {
    expect(UNAVAILABLE_AI_CARD_IDS).toEqual(['gpt-2', 'wenxin-yiyan'])
    expect(COMING_SOON_SKILL_CARD_IDS).toHaveLength(14)
    for (const cardId of [...UNAVAILABLE_AI_CARD_IDS, ...COMING_SOON_SKILL_CARD_IDS]) {
      expect(CARDS[cardId], `${cardId} 没有定义`).toBeDefined()
      expect(CARD_POOL).not.toContain(cardId)
    }
  })

  it('开放的 10 张技能卡都在卡池里，要选目标的正好是其中那 5 张', () => {
    for (const cardId of OPEN_SKILL_CARD_IDS) {
      expect(CARD_POOL).toContain(cardId)
      const card = CARDS[cardId]
      if (card?.kind !== 'skill') throw new Error(`${cardId} 不是技能牌`)
      expect(card.target).toBe(TARGETED_SKILLS[cardId])
    }
    expect(Object.keys(TARGETED_SKILLS).sort()).toEqual(
      OPEN_SKILL_CARD_IDS.filter((id) => TARGETED_SKILLS[id] !== undefined).sort(),
    )
  })
})

describe('展示清单和选不了的原因', () => {
  it('展示清单 = 卡池 + 两批灰卡，灰卡排在最后', () => {
    expect(DECK_DISPLAY_CARD_IDS).toEqual([
      ...CARD_POOL,
      ...COMING_SOON_SKILL_CARD_IDS,
      ...UNAVAILABLE_AI_CARD_IDS,
    ])
    // 排序全靠这一行拼接，所以「前面一段都能选、后面一段都不能选」是它唯一要守的性质。
    const firstBlocked = DECK_DISPLAY_CARD_IDS.findIndex((id) => blockedReasonOf(id) !== null)
    expect(firstBlocked).toBe(CARD_POOL.length)
    for (const cardId of DECK_DISPLAY_CARD_IDS.slice(firstBlocked)) {
      expect(blockedReasonOf(cardId)).not.toBeNull()
    }
  })

  it('两批灰卡各说各的那句话，卡池里的一律能选', () => {
    for (const cardId of COMING_SOON_SKILL_CARD_IDS)
      expect(blockedReasonOf(cardId)).toBe('即将上线')
    for (const cardId of UNAVAILABLE_AI_CARD_IDS) expect(blockedReasonOf(cardId)).toBe('暂未接入')
    for (const cardId of CARD_POOL) expect(blockedReasonOf(cardId)).toBeNull()
  })

  it('认得出哪些是 AI 牌：18 张全认、技能牌一张都不认', () => {
    for (const cardId of AI_MODEL_CARD_IDS) expect(isAiCard(cardId)).toBe(true)
    for (const cardId of OPEN_SKILL_CARD_IDS) expect(isAiCard(cardId)).toBe(false)
  })
})
