/**
 * 内容数据的 zod schema，对应《正式版架构》6.4 第一条。
 *
 * 分两种用法，别搞混：
 * - **JSON 数据**（题库、注入提示词、预生成答案表）在模块加载时 parse 一次，
 *   坏数据一来就炸，而不是打到某一轮才炸；
 * - **TS 数据**（AI 牌、技能牌、英雄）本来就有类型检查兜着，schema 在测试里过一遍，
 *   补的是类型查不了的那些约束：字符串不能为空、费用是正整数、键和 id 对得上、
 *   evolvesTo 指向的卡确实存在。
 *
 * 每个 schema 都用 `satisfies z.ZodType<核心类型>` 和 core 的类型钉在一起：
 * 类型改了而 schema 没跟着改，这个包就编译不过。
 */

export * from './card'
export * from './hero'
export * from './interferencePrompts'
export * from './pregenAnswers'
export * from './question'
