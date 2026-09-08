import type { CardId } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_CARDS,
  CARDS,
  createCatalog,
  OPEN_SKILL_CARD_IDS,
  PLAYABLE_AI_CARD_IDS,
  SKILL_DESIGN_CARDS,
} from '../src/index'

/**
 * 逐张卡的数值和标签。
 *
 * 费用和 domestic 这两样是**平衡数值**，不是文案：费用决定一轮铺得下几张牌，
 * domestic 决定「国产替代」清场时谁留下。它们躺在卡表里，改一个数字不会有任何检查发红，
 * 所以这里把它们抄成一张表锁住——改平衡要顺手改这张表，等于强迫改动的人说一句"我知道我在改什么"。
 *
 * 抄一份表在测试里当然是重复，但这正是它的用处：两处对不上就说明有人改了数值。
 * 卡面文案（name / text / skillText）不锁，那些会随润色变，锁了只会天天挡人。
 */

/** 18 张 AI 的印刷费用。区间 1~7，大致按"越新越全能越贵"排（见 src/aiModels.ts）。 */
const AI_TOKEN_COST: Record<CardId, number> = {
  'gpt-2': 1,
  'gpt-3-5': 2,
  'gpt-4o': 4,
  'chatgpt-5-6-sol': 5,
  'claude-5-sonnet': 4,
  'claude-fable-5': 7,
  'deepseek-r1': 3,
  'deepseek-v4': 4,
  gemini: 3,
  qwen: 3,
  'kimi-k2-6': 3,
  'kimi-k3': 4,
  doubao: 2,
  'glm-5': 4,
  minimax: 3,
  yuanbao: 3,
  grok: 3,
  'wenxin-yiyan': 3,
}

/** 10 张已开放技能牌的印刷费用。 */
const SKILL_TOKEN_COST: Record<CardId, number> = {
  'black-white-reversal': 3,
  'fixed-answer': 4,
  'jade-purification-vase': 2,
  'golden-bell-shield': 3,
  'safe-pass': 3,
  'model-distillation': 2,
  'nuclear-power-station': 3,
  'domestic-substitution': 6,
  'rising-tide': 2,
  'memory-shortage': 6,
}

/** 带 `domestic` 标签的 10 张：「国产替代」把没标的全部罚下，包括打出方自己那边。 */
const DOMESTIC_IDS: CardId[] = [
  'deepseek-r1',
  'deepseek-v4',
  'qwen',
  'kimi-k2-6',
  'kimi-k3',
  'doubao',
  'glm-5',
  'minimax',
  'yuanbao',
  'wenxin-yiyan',
]

/** 四条进化链，从老到新。链尾和这里没出现的 8 张升不了也降不了。 */
const CHAINS: CardId[][] = [
  ['gpt-2', 'gpt-3-5', 'gpt-4o', 'chatgpt-5-6-sol'],
  ['claude-5-sonnet', 'claude-fable-5'],
  ['deepseek-r1', 'deepseek-v4'],
  ['kimi-k2-6', 'kimi-k3'],
]

describe('AI 牌', () => {
  it('每张的费用和平衡表一致', () => {
    expect(
      Object.fromEntries(Object.values(AI_MODEL_CARDS).map((card) => [card.id, card.tokenCost])),
    ).toEqual(AI_TOKEN_COST)
  })

  it('国产标签正好是那 10 张', () => {
    const domestic = Object.values(AI_MODEL_CARDS)
      .filter((card) => card.domestic === true)
      .map((card) => card.id)
    expect(domestic.sort()).toEqual([...DOMESTIC_IDS].sort())
  })

  it('进化链就是这四条，链尾不再指向别人', () => {
    // 链条本身（顺着 evolvesTo 串出来的那份）在 core 的 aiModels.test.ts 里逐级核对过，
    // 这里锁的是"哪几张在链上、谁接谁"这个设计决定。
    for (const chain of CHAINS) {
      for (let i = 0; i < chain.length - 1; i++) {
        expect(AI_MODEL_CARDS[chain[i]!]?.evolvesTo, chain[i]).toBe(chain[i + 1])
      }
      expect(AI_MODEL_CARDS[chain.at(-1)!]?.evolvesTo, chain.at(-1)).toBeUndefined()
    }
    const onChain = new Set(CHAINS.flat())
    for (const card of Object.values(AI_MODEL_CARDS)) {
      if (!onChain.has(card.id)) expect(card.evolvesTo, card.id).toBeUndefined()
    }
  })

  it('能上场的 16 张都配了 OpenRouter 模型，另外两张明确是 null', () => {
    for (const card of Object.values(AI_MODEL_CARDS)) {
      const playable = PLAYABLE_AI_CARD_IDS.includes(card.id)
      expect(card.openrouter === null, card.id).toBe(!playable)
    }
    expect(PLAYABLE_AI_CARD_IDS).toHaveLength(16)
  })
})

describe('已开放的技能牌', () => {
  it('每张的费用和平衡表一致', () => {
    expect(
      Object.fromEntries(OPEN_SKILL_CARD_IDS.map((id) => [id, SKILL_DESIGN_CARDS[id]?.tokenCost])),
    ).toEqual(SKILL_TOKEN_COST)
  })
})

describe('内容目录', () => {
  it('createCatalog 给出的就是整张卡表和整张英雄表', () => {
    const catalog = createCatalog()
    // 装的是整个公开卡池（连进不了牌组的那些一起），不是双方牌组里那几张：
    // 卡池是公开信息，界面要能从对局状态里查到任意一张卡的卡面（见 core 的 Catalog）。
    expect(Object.keys(catalog.cards)).toEqual(Object.keys(CARDS))
    expect(Object.keys(catalog.heroes)).toHaveLength(7)
  })

  it('每局共用同一份目录对象，不做拷贝', () => {
    // 目录是只读的，每开一局拷一份几十 KB 的卡表纯属浪费（见 src/catalog.ts）。
    expect(createCatalog().cards).toBe(createCatalog().cards)
  })
})
