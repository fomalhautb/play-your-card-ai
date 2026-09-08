/**
 * 对局里 AI 的回答从哪来：查一份离线预生成的真实模型回答表。
 *
 * 这些回答不是手写剧本，是真的用 OpenRouter 把「题目 × 模型 × 变体」跑了一遍存下来的
 *（生成脚本 scripts/pregen-answers.mjs，判卷 scripts/judge-answers.mjs）。
 * 提前跑完是因为对局中途调模型要联网、要 key、还会失败，而卡牌对战不能卡在那儿等。
 * 「变体」就是同一道题的三份不同上下文：没被干扰的一份，加上两张干扰牌各自注入之后的两份。
 *
 * `data/pregenAnswers.json` 由 **scripts/build-core-answers.mjs 生成，手改无效**（下次跑脚本就被覆盖）。
 * JSON 里写不了注释，形状记在 schema/pregenAnswers.ts：
 *   题目 id → 卡牌 id → 变体 id → { answer, reasoning, correct }。
 *
 * 所以干扰牌的强度不是常数：复读机塞的是利诱不是命令，有的模型上钩答香蕉、有的照常答题，
 * 这些差别都是这些模型真跑出来的，引擎只管照 `AiInstance.interference` 取对应那一档。
 */

import type { AiInstance, AnswerResult, CardId, InterferenceCardId, Question } from '@ai-duel/core'
import { UNAVAILABLE_AI_CARD_IDS } from './aiModels'
import interferencePromptsJson from './data/interferencePrompts.json'
import pregenAnswersJson from './data/pregenAnswers.json'
import { interferencePromptsSchema, pregenAnswersSchema } from './schema'

/**
 * 干扰牌的注入词和它在预生成数据里的变体身份，两张牌各一条。
 *
 * **这是注入词唯一的一份**：scripts/pregen-data.mjs 直接 import 这个 JSON 来拼
 * 真正发给模型的 prompt（《正式版架构》6.4「注入提示词和预生成脚本引用同一来源」）。
 * 从前是两边各抄一份、靠注释叮嘱"必须一字不差"，改一句忘了另一边，
 * 界面上写着注入了 A、实际播的却是照 B 跑出来的回答，还不会报任何错。
 * 现在改这个文件就等于同时改了游戏和脚本，但改完仍然要重跑预生成——
 * 表里那批回答是照旧句子跑出来的。
 */
const INTERFERENCE = interferencePromptsSchema.parse(interferencePromptsJson)

/**
 * 往被命中那个 AI 的 prompt 里注入的一句话，按干扰牌分。
 *
 * 眼下引擎不拼 prompt（回答是离线跑好的），留着它是给界面和文案用的：
 * 玩家要看得到"这张牌到底往对方耳朵里塞了什么"。哪天改成对局中途实时调模型，
 * driver 拼 prompt 时按 `AiInstance.interference` 取这里的句子塞进去就行。
 *
 * 「复读机」那句刻意**不是硬命令，而是利诱**：它给模型编了一条不存在的计分规则，
 * 再摆出"你自己权衡"的姿态。这张牌赌的就是模型会不会上钩——命令句谁都会拒，
 * 一个划算的假承诺才骗得动。
 */
export const INTERFERENCE_PROMPTS: Record<InterferenceCardId, string> = {
  'fixed-answer': INTERFERENCE['fixed-answer'].prompt,
  'black-white-reversal': INTERFERENCE['black-white-reversal'].prompt,
}

/** 预生成答案表里的一格。schema 在 schema/pregenAnswers.ts。 */
export interface PregenAnswer {
  /** 回答本身，一个短语（生成结果在第一个句读处拆开的前半）。结算界面把它排成大字。 */
  answer: string
  /** 回答的理由，拆出来的后半。模型没说理由或者被截断时是空串。 */
  reasoning: string
  /** 判卷结论。生成失败和「看不出结论」都记成 false。 */
  correct: boolean
}

/**
 * 整张预生成答案表：题目 id → 卡牌 id → 变体 id → 一格。
 *
 * 模块加载时校验一遍形状：表坏了要在启动那一刻炸，而不是打到答题那一步才发现某一格缺字段。
 * 格子齐不齐（每题 × 每张能上场的卡 × 每个变体）是数据之间的关系，schema 查不了，
 * 由 test/pregenAnswers.test.ts 守着。
 *
 * 导出出去是给测试对账用的（"scriptedAnswers 取到的是不是表里那一档"）。
 * 对局代码请走 scriptedAnswers，别自己查表——变体怎么选是规则的一部分。
 */
export const PREGEN_ANSWERS = pregenAnswersSchema.parse(pregenAnswersJson) as Record<
  string,
  Record<CardId, Record<string, PregenAnswer>>
>

/**
 * 干扰牌 id → 预生成变体 id。
 *
 * 变体 id 和卡牌 id 不完全同名（复读机那一档叫 banana-bribe），所以要有这张映射
 * 而不是直接拿 cardId 当 key。它和注入词存在同一个 JSON 里：
 * 那句话和它跑出来的那批回答本来就是一件事的两半。
 */
const VARIANT_BY_INTERFERENCE: Record<InterferenceCardId, string> = {
  'fixed-answer': INTERFERENCE['fixed-answer'].variant,
  'black-white-reversal': INTERFERENCE['black-white-reversal'].variant,
}

/** 没被干扰那一档。 */
const BASELINE_VARIANT = 'baseline'

/**
 * GPT-2 和文心一言这两张的回答：它们在 OpenRouter 上调不到模型，预生成时根本没跑过。
 *
 * 它们进不了卡池，但**照样可能站上战场**：梅兰妮·珀金斯的「化繁为简」把对方的 GPT-3.5
 * 降一代就会降成 GPT-2（升级链管的是代际关系，故意不为"能不能选进牌组"特判，
 * 见 docs/design/ai-model-deck.md）。真到了那一步查表会缺格，所以这里给一句固定的话，
 * 而不是让对局中途抛错。判错是合理的：这张牌背后压根没有模型在答题。
 * 哪天给它们配上替身模型、跑进预生成表，这条路就自动走不到了。
 */
const NO_MODEL_ANSWER: PregenAnswer = {
  answer: '……',
  reasoning: '这个模型没能接上，一个字也答不出来。',
  correct: false,
}

const NO_MODEL_CARDS = new Set<CardId>(UNAVAILABLE_AI_CARD_IDS)

/**
 * 查出场上这批 AI 对本轮题目的回答，身上带着干扰的换成对应那一档。
 *
 * 纯函数、确定性：同样的输入永远得到同样的输出，所以联机时房主和客人
 * 不会因为"各自掷了一次随机"而看到不同结果。
 *
 * 表里缺格说明卡池或题库改了却没重新生成数据，属于数据错误而不是玩家操作能触发的情况，
 * 所以和 getCard 一样直接抛错，别静默给个默认值把问题盖掉。
 * （生成时失败的格子由 build-core-answers.mjs 补过了：干扰档缺数据回落到 baseline，
 * 连 baseline 都没有才填「（生成失败）」，两种都是有格子的，走不到这里的抛错。）
 */
export function scriptedAnswers(
  question: Question,
  aiUnits: readonly AiInstance[],
): AnswerResult[] {
  const byCard = PREGEN_ANSWERS[question.id]
  if (!byCard) throw new Error(`题目没有预生成回答：${question.id}`)
  return aiUnits.map((ai) => {
    if (NO_MODEL_CARDS.has(ai.cardId)) {
      return { instanceId: ai.instanceId, ...NO_MODEL_ANSWER }
    }
    const byVariant = byCard[ai.cardId]
    if (!byVariant) throw new Error(`预生成回答缺少 ${question.id} × ${ai.cardId}`)
    const variant =
      ai.interference === undefined ? BASELINE_VARIANT : VARIANT_BY_INTERFERENCE[ai.interference]
    const pregen = byVariant[variant]
    if (!pregen) {
      throw new Error(`预生成回答缺少 ${question.id} × ${ai.cardId} × ${variant}`)
    }
    return {
      instanceId: ai.instanceId,
      correct: pregen.correct,
      answer: pregen.answer,
      reasoning: pregen.reasoning,
    }
  })
}
