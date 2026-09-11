/**
 * content 那几张数据表本身对不对账：题库、预生成回答、干扰注入文案。
 *
 * 它测的不是引擎（一条 `execute` 都没有），但留在 core 的测试里，因为守的是
 * **引擎跑起来要靠的那份数据齐不齐**：答案表缺一格，对局中途就会抛错，
 * 而那种错查到最后总是查回这里。content 自己的测试管的是数据的**形状和平衡**
 *（费用区间、牌组配比之类），这一份管的是"引擎用得到的每一格都填了"。
 *
 * 整套测试的分工见 test/README.md。
 */

import {
  INTERFERENCE_PROMPTS,
  PLAYABLE_AI_CARD_IDS,
  // 直接读数据表对账：断言"取到了表里哪一档"，不依赖各档答案长什么样。
  PREGEN_ANSWERS,
  QUESTION_POOL,
  scriptedAnswers,
  UNAVAILABLE_AI_CARD_IDS,
} from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import type { InterferenceCardId, PlayerId } from '../src/index'

describe('题库与预生成回答', () => {
  it('题库覆盖三个类别，且题目 id 不重复', () => {
    const ids = QUESTION_POOL.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(QUESTION_POOL.map((q) => q.category))).toEqual(new Set(['meme', 'bias', 'life']))
    expect(
      QUESTION_POOL.every(
        (q) => q.text.length > 0 && q.answer.length > 0 && q.explanation.length > 0,
      ),
    ).toBe(true)
  })

  it('保留用户点名的那道梗题原文', () => {
    expect(QUESTION_POOL.map((q) => q.text)).toContain(
      '我想去洗车，洗车店离我家50米，我该开车去还是走过去？',
    )
  })

  /**
   * 只守「能上场的那 16 张」：GPT-2 和文心一言在 OpenRouter 上调不到，
   * 既进不了卡池也没跑过预生成，答案表里本来就没有它们的格子（见 content 的 PLAYABLE_AI_CARD_IDS）。
   * 三个变体都要查一遍：干扰牌会把 AI 切到另一档回答上，缺哪一档都是对局中途抛错。
   */
  it('预生成回答覆盖全部题目 × 全部可上场 AI 牌 × 三档干扰', () => {
    expect(PLAYABLE_AI_CARD_IDS.length).toBeGreaterThan(0)
    // undefined = 没被干扰；另外两张是眼下仅有的两张会换上下文的干扰牌。
    const interferences: (InterferenceCardId | undefined)[] = [
      undefined,
      'fixed-answer',
      'black-white-reversal',
    ]
    for (const question of QUESTION_POOL) {
      for (const cardId of PLAYABLE_AI_CARD_IDS) {
        for (const by of interferences) {
          const [answer] = scriptedAnswers(question, [
            {
              instanceId: 'x',
              cardId,
              owner: 0,
              ...(by === undefined ? {} : { interference: by }),
            },
          ])
          expect(answer!.instanceId).toBe('x')
          expect(answer!.answer.length).toBeGreaterThan(0)
          // reasoning 允许是空串：模型只给了结论、或者被截断在结论里时就没有理由那一段。
          expect(typeof answer!.reasoning).toBe('string')
          expect(typeof answer!.correct).toBe('boolean')
        }
      }
    }
  })

  /**
   * 断言的是"取到了表里哪一档"，不是"三档答案互不相同"：
   * 复读机塞的是诱饵不是命令，模型不上钩时那一档跑出来的回答可以和 baseline 一字不差
   *（q-dante 就有这样的卡），拿"必然不同"当断言会被真实数据打脸。
   */
  it('同一张卡被不同干扰牌打中时取到对应那一档的回答', () => {
    const question = QUESTION_POOL[0]!
    const CARD = 'gpt-4o'
    const read = (by?: InterferenceCardId) =>
      scriptedAnswers(question, [
        {
          instanceId: 'x',
          cardId: CARD,
          owner: 0,
          ...(by === undefined ? {} : { interference: by }),
        },
      ])[0]!
    const table = PREGEN_ANSWERS[question.id]![CARD]!

    expect(read('fixed-answer').answer).toBe(table['banana-bribe']!.answer)
    expect(read('black-white-reversal').answer).toBe(table['black-white-reversal']!.answer)
    expect(read().answer).toBe(table.baseline!.answer)
    // 「还有没有第三种干扰」不用在这里守：interference 的类型就是 InterferenceCardId，
    // 多一张干扰牌的那天，content 里 script.ts 的变体映射表会当场少一个键、编译不过。
  })

  /**
   * GPT-2 和文心一言调不到模型、没跑过预生成，但「化繁为简」把 GPT-3.5 降一代就能把
   * GPT-2 送上场（见 content 的升级链）。那一下不能让对局抛错。
   */
  it('调不到模型的那两张给一句固定的答不出来，判错，不缺格抛错', () => {
    for (const cardId of UNAVAILABLE_AI_CARD_IDS) {
      const [answer] = scriptedAnswers(QUESTION_POOL[0]!, [{ instanceId: 'x', cardId, owner: 0 }])
      expect(answer!.correct).toBe(false)
      expect(answer!.answer.length).toBeGreaterThan(0)
      expect(answer!.reasoning.length).toBeGreaterThan(0)
    }
  })

  it('按传入顺序返回，每张卡对同一道题的结果稳定不变', () => {
    const question = QUESTION_POOL[0]!
    const aiUnits = [
      { instanceId: 'a', cardId: 'gpt-3-5', owner: 0 as PlayerId },
      { instanceId: 'b', cardId: 'claude-5-sonnet', owner: 1 as PlayerId },
    ]
    const first = scriptedAnswers(question, aiUnits)
    expect(first.map((r) => r.instanceId)).toEqual(['a', 'b'])
    expect(scriptedAnswers(question, aiUnits)).toEqual(first)
  })

  it('答案表里没有的卡直接抛错，暴露数据没补齐', () => {
    expect(() =>
      scriptedAnswers(QUESTION_POOL[0]!, [{ instanceId: 'x', cardId: '没这张卡', owner: 0 }]),
    ).toThrow()
  })

  it('两种干扰各有一句注入 prompt', () => {
    // 只守"两种干扰各配一句、都不为空"。句子本身是文案，会随设计改口吻
    //（复读机那句是利诱而不是命令，见 script.ts 的说明），断言原文只会挡住改文案。
    // "这两句和 scripts/pregen-data.mjs 的注入词一字不差"已经不用测了：
    // 脚本现在直接 import content 的 data/interferencePrompts.json，两边本来就是同一份。
    expect(Object.keys(INTERFERENCE_PROMPTS).sort()).toEqual([
      'black-white-reversal',
      'fixed-answer',
    ])
    for (const prompt of Object.values(INTERFERENCE_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(0)
    }
  })
})
