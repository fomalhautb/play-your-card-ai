import { z } from 'zod'

/**
 * 预生成答案表里的一格：某道题、某张卡、某个干扰变体下那个模型答了什么。
 *
 * 这张表由 scripts/build-core-answers.mjs 生成（手改无效，下次跑脚本就被覆盖），
 * 所以 schema 守的是"生成器有没有写出对局能用的数据"，不是防人手滑。
 */
export const pregenAnswerSchema = z.object({
  // 结算界面把它排成大字，空串就是一张没有标题的结算卡，所以不许为空。
  // 生成失败的格子由脚本填成「（生成失败）」，也是有内容的。
  answer: z.string().min(1),
  // 理由是小字那一行，模型没说理由或者被截断时就是空串，允许。
  reasoning: z.string(),
  correct: z.boolean(),
})

/**
 * 整张表：题目 id → 卡牌 id → 变体 id → 一格。
 *
 * 三层都用 record 而不是把 8 道题 × 16 张卡 × 3 个变体列成固定键：
 * 那等于把题库和卡池又抄一遍，改一张卡就要改三处。
 * "格子齐不齐"这件事查的是数据之间的关系，不是数据的形状，所以放在测试里
 *（content/test/pregenAnswers.test.ts，对应《正式版架构》6.4 的「预生成答案表完整」）。
 */
export const pregenAnswersSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), z.record(z.string().min(1), pregenAnswerSchema)),
)
