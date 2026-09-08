/**
 * `core` 的 `Command` 的手写 zod schema，以及「哪些指令允许从网上进来」这条闸。
 *
 * 这是整个协议里唯一**必须**手写完整的 schema。别的载荷（事件、视图）是服务端自己算出来的，
 * 而指令是玩家客户端发上来的，是这套系统里唯一一处不可信输入：
 * 服务端在调 `execute` 之前就靠它挡掉畸形指令（《正式版架构》6.7 的作弊测试）。
 *
 * ## 三类指令，谁能发分得很清楚
 *
 * | 类 | schema | 联机时谁发 |
 * |---|---|---|
 * | 玩家操作 | `playerCommandSchema` | 客户端，走 `match:command` |
 * | 自动答题 | `submitAnswersCommandSchema` | **只有服务端**（房间 DO 的答题 autopilot） |
 * | 调试 | `debugCommandSchema` | **联机时谁都不能发** |
 *
 * `SUBMIT_ANSWERS` 不进 `playerCommandSchema` 是一条防作弊线，不是洁癖：
 * 那条指令直接决定谁答对了、谁得分，客户端能发就等于能宣布自己全对。
 * 《正式版架构》5.3 把答题 autopilot 搬进了服务端（延时用 DO 的 alarm、密钥也在服务端），
 * 所以联机时这条指令根本不该出现在电线上。
 *
 * `DEBUG_*` 四条同理：它们能凭空造牌、跳过阶段（见 core 的 `Command` 注释），
 * 是 dev 测试房专用的。引擎自己不做来源限制，挡住它们是这一层和服务端的事。
 * 单机和教程的 `localDriver` 想用就用 `debugCommandSchema` / `commandSchema`，
 * 那条路不过网。
 *
 * ## 和 core 的类型怎么钉在一起
 *
 * 两个方向都钉，缺一不可：
 * - `satisfies z.ZodType<Command>` 管「schema 别造出 core 没有的东西」；
 * - 文件末尾那两条 `Assert` 管「core 有的每一种指令这里都有分支」——
 *   core 加一种指令而这里没跟上，就是编译错误，不用等测试跑。
 */

import type { AnswerResult, Command } from '@ai-duel/core'
import { z } from 'zod'
import { cardIdSchema, instanceIdSchema, playerIdSchema } from './common'

/**
 * 一个 AI 的答题结果里那两段文字的长度上限。
 *
 * 答案是结算界面上那行大字、理由是它下面两行小字（见 core 的 `AnswerResult`），
 * 排版决定了它们本来就不长。不设 `min(1)`：空回答在规则上合法（模型可以什么都没说），
 * 界面留白就是了，不该整条指令作废。
 */
const ANSWER_MAX_LENGTH = 200
const REASONING_MAX_LENGTH = 500

/**
 * 一批答题结果最多几条。
 *
 * 挡的是「一条消息塞十万条结果把房间对象撑爆」，不是规则上限——
 * 牌组一共 20 张（content 的 `DECK_SIZE`），双方场上凑不出这么多单位。
 */
const ANSWER_RESULTS_MAX = 64

/** 一个 AI 的答题结果。 */
export const answerResultSchema = z.strictObject({
  instanceId: instanceIdSchema,
  correct: z.boolean(),
  answer: z.string().max(ANSWER_MAX_LENGTH),
  reasoning: z.string().max(REASONING_MAX_LENGTH),
}) satisfies z.ZodType<AnswerResult>

/** 打出一张手牌。`targetInstanceId` 只有标了 `target` 的技能牌要填。 */
export const playCardCommandSchema = z.strictObject({
  type: z.literal('PLAY_CARD'),
  player: playerIdSchema,
  instanceId: instanceIdSchema,
  targetInstanceId: instanceIdSchema.optional(),
})

/** 结束本方出牌。 */
export const endPlayCommandSchema = z.strictObject({
  type: z.literal('END_PLAY'),
  player: playerIdSchema,
})

/** 发动主动英雄技能，指定场上一个 AI 单位。 */
export const useHeroSkillCommandSchema = z.strictObject({
  type: z.literal('USE_HERO_SKILL'),
  player: playerIdSchema,
  targetInstanceId: instanceIdSchema,
})

/** 结算界面上点「进入下一轮」。 */
export const confirmRoundCommandSchema = z.strictObject({
  type: z.literal('CONFIRM_ROUND'),
  player: playerIdSchema,
})

/**
 * 提交本轮全场 AI 的答题结果。**只有服务端自己发**，联机时不从电线上收
 * （理由见文件头）。放在这里是因为单机的 `localDriver` 和服务端的 autopilot
 * 都要照这个形状造指令。
 */
export const submitAnswersCommandSchema = z.strictObject({
  type: z.literal('SUBMIT_ANSWERS'),
  results: z.array(answerResultSchema).max(ANSWER_RESULTS_MAX),
})

/** 给某位玩家加一张手牌。调试指令，联机时不接受。 */
export const debugAddCardCommandSchema = z.strictObject({
  type: z.literal('DEBUG_ADD_CARD'),
  player: playerIdSchema,
  cardId: cardIdSchema.optional(),
})

/** 弃掉某位玩家的一张手牌。调试指令，联机时不接受。 */
export const debugRemoveCardCommandSchema = z.strictObject({
  type: z.literal('DEBUG_REMOVE_CARD'),
  player: playerIdSchema,
  instanceId: instanceIdSchema.optional(),
})

/** 无视出牌轮次打出一张手牌。调试指令，联机时不接受。 */
export const debugPlayCardCommandSchema = z.strictObject({
  type: z.literal('DEBUG_PLAY_CARD'),
  player: playerIdSchema,
  instanceId: instanceIdSchema,
  targetInstanceId: instanceIdSchema.optional(),
})

/** 直接跳到答题阶段。调试指令，联机时不接受。 */
export const debugSkipToQuizCommandSchema = z.strictObject({
  type: z.literal('DEBUG_SKIP_TO_QUIZ'),
})

/**
 * 玩家能从网上发上来的四种指令，`match:command` 用的就是它。
 *
 * 注意它只管形状：`player` 字段是不是发送方自己的座位，由服务端拿连接身份核对
 * （schema 看不见「谁在发」）。这是 6.7 那条「用对方座位发指令要被拒」的落点。
 */
export const playerCommandSchema = z.discriminatedUnion('type', [
  playCardCommandSchema,
  endPlayCommandSchema,
  useHeroSkillCommandSchema,
  confirmRoundCommandSchema,
]) satisfies z.ZodType<Command>

/** 四条调试指令。只在开发模式下的本地 driver 里用，联机通道不认。 */
export const debugCommandSchema = z.discriminatedUnion('type', [
  debugAddCardCommandSchema,
  debugRemoveCardCommandSchema,
  debugPlayCardCommandSchema,
  debugSkipToQuizCommandSchema,
]) satisfies z.ZodType<Command>

/**
 * core 的 `Command` 的完整 schema，九种一个不少。
 *
 * 谁在用：单机 driver 校验自己造的指令、测试、以及下面那两条和 core 对表的断言。
 * **联机通道不要用它**——用了就等于放 `SUBMIT_ANSWERS` 和 `DEBUG_*` 进来。
 */
export const commandSchema = z.discriminatedUnion('type', [
  playCardCommandSchema,
  endPlayCommandSchema,
  useHeroSkillCommandSchema,
  submitAnswersCommandSchema,
  confirmRoundCommandSchema,
  debugAddCardCommandSchema,
  debugRemoveCardCommandSchema,
  debugPlayCardCommandSchema,
  debugSkipToQuizCommandSchema,
]) satisfies z.ZodType<Command>

/** 客户端能发的那四种指令。 */
export type PlayerCommand = z.infer<typeof playerCommandSchema>

/** 四条调试指令。 */
export type DebugCommand = z.infer<typeof debugCommandSchema>

/**
 * 类型层面的断言工具：`Assert<false>` 直接编译报错。
 *
 * 下面两条用它把 schema 和 core 的 `Command` 双向对上——
 * 光有 `satisfies z.ZodType<Command>` 只保证「schema 造不出 core 没有的形状」，
 * core 新加一种指令而这里漏了分支，那句 satisfies 是不会响的。
 */
type Assert<T extends true> = T

/** core 有的每一种指令，`commandSchema` 都认得。漏一种这里就红。 */
type _EveryCommandHasSchema = Assert<Command extends z.infer<typeof commandSchema> ? true : false>

/** `commandSchema` 认得的每一种形状，core 都有。多一个字段这里就红。 */
type _SchemaAddsNothing = Assert<z.infer<typeof commandSchema> extends Command ? true : false>
