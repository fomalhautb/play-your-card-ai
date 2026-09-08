import type { AiCard, HandCard, SkillCard } from '@ai-duel/core'
import { z } from 'zod'

/** 卡面上那枚「N TOKEN」圆章：正整数，0 费和负费在引擎里没有意义。 */
const tokenCostSchema = z.number().int().positive()

/**
 * AI 牌。
 *
 * 每条 `satisfies z.ZodType<...>` 都是把 schema 钉在 core 类型上的钉子：
 * core 的类型加了字段而这里漏了，这一行就编译报错（见 README 的「schema 和类型怎么钉在一起」）。
 */
export const aiCardSchema = z.object({
  kind: z.literal('ai'),
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().min(1),
  tokenCost: tokenCostSchema,
  model: z.string().min(1),
  skillName: z.string().min(1),
  skillText: z.string().min(1),
  // null 是"OpenRouter 上没有这个模型"，和"忘了填"要分得开，所以是必填的可空字段。
  openrouter: z.string().min(1).nullable(),
  // 只标 true 不标 false：没这一项就是非国产（见 core 的 AiCard.domestic）。
  domestic: z.literal(true).optional(),
  // 进化链的下一级。指向的那张卡在不在表里由整表 schema 管，单张查不了。
  evolvesTo: z.string().min(1).optional(),
}) satisfies z.ZodType<AiCard>

/** 技能牌。 */
export const skillCardSchema = z.object({
  kind: z.literal('skill'),
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().min(1),
  tokenCost: tokenCostSchema,
  target: z.enum(['foe-ai', 'own-ai', 'own-affected-ai', 'own-hand-ai']).optional(),
  plannedEffect: z.string().min(1).optional(),
}) satisfies z.ZodType<SkillCard>

/** 牌组里能出现的两类牌。按 kind 分派，报错信息才会指向真正出问题的那一支。 */
export const handCardSchema = z.discriminatedUnion('kind', [
  aiCardSchema,
  skillCardSchema,
]) satisfies z.ZodType<HandCard>

/**
 * 整张卡表：键必须和卡自己的 id 一致，而且 evolvesTo 指向的卡要真的在表里。
 *
 * 这两条只有拿到整张表才查得了，所以放在这里而不是单张卡的 schema 上。
 * 键和 id 对不上会让"按 id 查卡"和"遍历卡表"给出两套答案；
 * evolvesTo 指向一张不存在的卡，则会在「鸡犬升天」把单位换过去之后，
 * 下一次查卡面时才炸——那时已经离出问题的地方很远了。
 */
export const cardTableSchema = z
  .record(z.string().min(1), handCardSchema)
  .refine((cards) => Object.entries(cards).every(([id, card]) => card.id === id), {
    message: '卡表的键和卡自己的 id 对不上',
  })
  .refine(
    (cards) =>
      Object.values(cards).every(
        (card) => card.kind !== 'ai' || card.evolvesTo === undefined || card.evolvesTo in cards,
      ),
    { message: 'evolvesTo 指向了一张不在表里的卡' },
  )
  .refine(
    (cards) => {
      // 每张卡最多被一张卡指为下一代：否则"上一代是谁"没有唯一答案，
      // core 的 downgradeTargetOf（反着找谁指着我）会取到先扫到的那张。
      const targets = Object.values(cards)
        .map((card) => (card.kind === 'ai' ? card.evolvesTo : undefined))
        .filter((id) => id !== undefined)
      return new Set(targets).size === targets.length
    },
    { message: '同一张卡被两张卡指为进化目标' },
  )
