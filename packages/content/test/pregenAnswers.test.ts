import type { AiInstance } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import interferencePromptsJson from '../src/data/interferencePrompts.json'
import pregenAnswers from '../src/data/pregenAnswers.json'
import {
  INTERFERENCE_PROMPTS,
  PLAYABLE_AI_CARD_IDS,
  QUESTION_POOL,
  scriptedAnswers,
  UNAVAILABLE_AI_CARD_IDS,
} from '../src/index'

/**
 * 《正式版架构》6.4：预生成答案表完整——每题、每卡、每变体都有值。
 *
 * 表缺一格不会有任何静态检查抓得到：卡池加一张牌、题库加一道题而没重跑
 * scripts/build-core-answers.mjs，要等对局打到那一格才 throw，而且只对那一对组合复现。
 * 所以这条断言是那种错误唯一的拦网。
 */

/** 表里第三层的键：没被干扰的 baseline，加上两张干扰牌各自那一档。 */
const VARIANTS = [
  'baseline',
  ...Object.values(interferencePromptsJson).map((entry) => entry.variant),
]

const TABLE = pregenAnswers as Record<
  string,
  Record<string, Record<string, { answer: string; reasoning: string; correct: boolean }>>
>

const unitOf = (cardId: string): AiInstance => ({ instanceId: 'x', cardId, owner: 0 })

describe('预生成答案表', () => {
  it('每题 × 每张能上场的 AI × 每个变体都有一格，answer 不为空', () => {
    // 一次跑完再统一断言，而不是逐格 expect：缺 20 格时要一次看到 20 格是哪些，
    // 否则修一格跑一次，得跑 20 遍。
    const missing: string[] = []
    for (const question of QUESTION_POOL) {
      for (const cardId of PLAYABLE_AI_CARD_IDS) {
        for (const variant of VARIANTS) {
          const cell = TABLE[question.id]?.[cardId]?.[variant]
          if (!cell?.answer) missing.push(`${question.id} × ${cardId} × ${variant}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('表里没有多余的题目或卡：题库和卡池删东西时要跟着重新生成', () => {
    // 多出来的格子不影响对局，但说明这张表和现在的题库、卡池已经不是一批数据了，
    // 那么"少了的那些格子"多半也在同一次改动里被漏掉。
    expect(Object.keys(TABLE).sort()).toEqual(QUESTION_POOL.map((q) => q.id).sort())
    for (const byCard of Object.values(TABLE)) {
      expect(Object.keys(byCard).sort()).toEqual([...PLAYABLE_AI_CARD_IDS].sort())
    }
  })
})

describe('查表', () => {
  it('每张能上场的 AI，三档都查得到回答', () => {
    const question = QUESTION_POOL[0]!
    for (const cardId of PLAYABLE_AI_CARD_IDS) {
      const [baseline] = scriptedAnswers(question, [unitOf(cardId)])
      expect(baseline?.answer, cardId).toBeTruthy()
      for (const interference of Object.keys(INTERFERENCE_PROMPTS)) {
        const [answer] = scriptedAnswers(question, [
          { ...unitOf(cardId), interference: interference as 'fixed-answer' },
        ])
        expect(answer?.answer, `${cardId} × ${interference}`).toBeTruthy()
      }
    }
  })

  it('调不到模型的那两张答固定的一句，不去查表', () => {
    // 它们进不了牌组，但英雄技能「化繁为简」能把对面降级降出来（见 src/aiModels.ts 的升级链），
    // 真站上场时表里没有它们的格子。
    const question = QUESTION_POOL[0]!
    for (const cardId of UNAVAILABLE_AI_CARD_IDS) {
      const [answer] = scriptedAnswers(question, [unitOf(cardId)])
      expect(answer?.correct, cardId).toBe(false)
      expect(answer?.answer, cardId).toBe('……')
    }
  })

  it('题库或卡池里没有的东西查表就抛错，不静默给个默认值', () => {
    const question = QUESTION_POOL[0]!
    expect(() => scriptedAnswers({ ...question, id: '没这道题' }, [unitOf('gpt-4o')])).toThrow()
    expect(() => scriptedAnswers(question, [unitOf('没这张卡')])).toThrow()
  })
})

describe('注入提示词', () => {
  it('两张干扰牌各一条，和预生成变体一一对上', () => {
    // 这份 JSON 是注入词唯一的一份：scripts/pregen-data.mjs 也 import 它来拼 prompt
    //（6.4「注入提示词和预生成脚本引用同一来源」）。
    expect(Object.keys(INTERFERENCE_PROMPTS).sort()).toEqual([
      'black-white-reversal',
      'fixed-answer',
    ])
    for (const prompt of Object.values(INTERFERENCE_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(0)
    }
    // 变体 id 必须真的是表里第三层用的键，否则查表会落空。
    for (const entry of Object.values(interferencePromptsJson)) {
      expect(VARIANTS).toContain(entry.variant)
      expect(Object.values(TABLE)[0]?.['gpt-4o']?.[entry.variant]).toBeDefined()
    }
  })
})
