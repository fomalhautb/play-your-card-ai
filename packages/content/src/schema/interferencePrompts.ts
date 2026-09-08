import type { InterferenceCardId } from '@ai-duel/core'
import { z } from 'zod'

/** 两张干扰技能牌的 id。和 core 的 InterferenceCardId 对不上时下面那句 satisfies 会编译报错。 */
export const interferenceCardIdSchema = z.enum([
  'fixed-answer',
  'black-white-reversal',
]) satisfies z.ZodType<InterferenceCardId>

/**
 * 一张干扰牌往被命中的 AI 的 prompt 里塞的那句话，外加它在预生成数据里的变体身份。
 *
 * 三个字段绑在一起是《正式版架构》6.4「注入提示词和预生成脚本引用同一来源」那条：
 * 注入词是离线预生成时真正发给模型的那句，变体 id 是那批结果在答案表里的键，
 * 名字是跑批日志里的标签。分开存的话，改了注入词而没重跑数据，
 * 界面上写着注入了 A、播的却是照 B 跑出来的回答，谁都看不出来。
 */
export const interferencePromptSchema = z.object({
  /** 预生成答案表第三层的键。和卡牌 id 不同名（复读机那档叫 banana-bribe）。 */
  variant: z.string().min(1),
  /** 跑批脚本日志里显示的名字。 */
  name: z.string().min(1),
  /** 注入词本体。 */
  prompt: z.string().min(1),
})

/** 两张干扰牌各一条，一条都不能少：漏了哪张，那张牌打出去就没有对应的回答可查。 */
export const interferencePromptsSchema = z.record(
  interferenceCardIdSchema,
  interferencePromptSchema,
)
