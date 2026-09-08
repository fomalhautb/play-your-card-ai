import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARDS, CARDS, HEROES, QUESTION_POOL, SKILL_DESIGN_CARDS } from '../src/index'
import {
  aiCardSchema,
  cardTableSchema,
  heroCardSchema,
  heroTableSchema,
  questionPoolSchema,
  skillCardSchema,
} from '../src/schema'

/**
 * 《正式版架构》6.4 第一条：所有内容数据过一遍 zod schema。
 *
 * 手写的那几张表（AI 牌、技能牌、英雄）是 TS 常量，形状本来就有类型检查兜着，
 * 所以这里查的是类型查不了的那半边：字符串不是空的、费用是正整数、
 * 表的键和卡自己的 id 对得上、evolvesTo 指向的卡真的存在。
 *
 * JSON 那几份（题库、注入提示词、预生成答案表）在模块加载时就 parse 过了
 *（见 src/questions.ts 和 src/script.ts），import 得进来就说明它们已经过关；
 * 这里再断言一次是为了让"哪份数据被谁守着"在测试里看得见。
 */

describe('卡表', () => {
  it('整张表过 schema：键和 id 对得上，进化链指向表里的卡', () => {
    expect(() => cardTableSchema.parse(CARDS)).not.toThrow()
  })

  it('每张 AI 牌单独过一遍，坏在哪张一眼看得到', () => {
    for (const [id, card] of Object.entries(AI_MODEL_CARDS)) {
      // 逐张 parse 而不是整张表一把过：整表报错只说"某处不对"，
      // 逐张报错会带上卡的 id，改数据的人不用自己数第几个。
      expect(() => aiCardSchema.parse(card), id).not.toThrow()
    }
  })

  it('每张技能牌单独过一遍', () => {
    for (const [id, card] of Object.entries(SKILL_DESIGN_CARDS)) {
      expect(() => skillCardSchema.parse(card), id).not.toThrow()
    }
  })

  it('AI 牌和技能牌合起来就是整张卡表，没有第三类', () => {
    expect(Object.keys(CARDS)).toEqual([
      ...Object.keys(AI_MODEL_CARDS),
      ...Object.keys(SKILL_DESIGN_CARDS),
    ])
  })
})

describe('英雄表', () => {
  it('整张表过 schema', () => {
    expect(() => heroTableSchema.parse(HEROES)).not.toThrow()
  })

  it('每位英雄单独过一遍', () => {
    for (const [id, hero] of Object.entries(HEROES)) {
      expect(() => heroCardSchema.parse(hero), id).not.toThrow()
    }
  })

  it('comingSoon 的几位不写对局定位', () => {
    // roleText 讲的是"什么时候该选他"，技能还没实装就谈不上定位（见 src/heroes.ts 的说明）。
    // 反过来不成立：已实装的霍珀也没有 roleText，那几条是后来新设计的几位才补的。
    for (const hero of Object.values(HEROES)) {
      if (hero.comingSoon === true) expect(hero.roleText, hero.id).toBeUndefined()
    }
  })
})

describe('题库', () => {
  it('过 schema，且题目 id 不重复', () => {
    expect(() => questionPoolSchema.parse(QUESTION_POOL)).not.toThrow()
  })

  it('8 道题，三类都有', () => {
    // 题库长度就是一局的轮次上限（totalRounds），少一道等于少一轮加赛的余地。
    expect(QUESTION_POOL).toHaveLength(8)
    expect(new Set(QUESTION_POOL.map((q) => q.category))).toEqual(new Set(['meme', 'bias', 'life']))
  })
})
