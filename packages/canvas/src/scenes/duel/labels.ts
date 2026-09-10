/**
 * core 的枚举 → 界面上那句中文。
 *
 * 放在场景这一层而不是编排层：cue 的载荷带的是引擎的枚举值，翻成哪国话是画面的事
 *（编排层里另有一份同样的表，那一份拼的是横幅文案，见 director/events.ts）。
 * 第 31 条重做文字界面时这里会并进一份统一的文案表。
 */

import type { QuestionCategory, RoundVerdict } from '@ai-duel/core'

/** 题目类别。侧栏的「下一题」纸匾和结算层顶栏的类别药丸都读它。 */
export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  meme: '梗题',
  bias: '刻板印象',
  life: '生活类',
}

/** 本轮那 1 分是怎么分出来的，结算层底栏那句结论。文案抄旧版 RoundSettleLayer 的三档。 */
export const VERDICT_LABELS: Record<RoundVerdict, string> = {
  'more-correct': '答对更多，本轮 +1',
  'fewer-tokens': '答对数持平，消耗更少者 +1',
  'equal-tokens': '答对数与消耗均持平，双方各 +1',
}
