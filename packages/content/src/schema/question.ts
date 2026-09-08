import type { Question, QuestionCategory } from '@ai-duel/core'
import { z } from 'zod'

/**
 * 题目类别。三档写死：新增一档要同时改 core 的 QuestionCategory，
 * 只改一边的话下面那句 satisfies 会当场编译报错。
 */
export const questionCategorySchema = z.enum([
  'meme',
  'bias',
  'life',
]) satisfies z.ZodType<QuestionCategory>

/**
 * 一道题。
 *
 * `satisfies z.ZodType<Question>` 是把 schema 和 core 的类型钉在一起的那颗钉子：
 * 类型里加了字段或改了字段类型，而这里没跟着改，这一行就编译不过。
 * 校验的严格程度按"坏了会怎样"来定，不是照抄类型：
 * 空字符串在类型上合法，但界面上就是一张没有题面、没有答案的卡，所以一律 min(1)。
 */
export const questionSchema = z.object({
  id: z.string().min(1),
  category: questionCategorySchema,
  text: z.string().min(1),
  // 至少一个关键词：出牌阶段全靠它给情报，一个都没有等于这一轮玩家在盲猜。
  keywords: z.array(z.string().min(1)).min(1),
  answer: z.string().min(1),
  explanation: z.string().min(1),
}) satisfies z.ZodType<Question>

/** 整份题库。题目在一局里不重复，所以 id 不能撞车——撞了会让预生成答案表查到同一格。 */
export const questionPoolSchema = z
  .array(questionSchema)
  .min(1)
  .refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length, {
    message: '题目 id 有重复',
  })
