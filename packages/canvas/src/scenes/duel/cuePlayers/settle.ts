/**
 * 回合结算层那九段：立起来、逐张添结果卡、揭标准答案、逐张打字、盖章、亮正确数、
 * 底栏比分、确认按钮、整层退场。
 *
 * 编排层已经把整条时间线排好了（settleTimeline.ts 用绝对时刻串），这里一条 cue 对一次调用，
 * 不做任何排期。唯一多做的是把 core 的枚举翻成中文（题目类别、本轮判据）——
 * 那是界面文案，不该进编排层的 cue 载荷。
 */

import type { QuestionCategory, RoundVerdict } from '@ai-duel/core'
import type { SettleSide } from '../../../components/SettleLayer'
import type { CuePlayerGroup } from './types'

/**
 * 题目类别的中文名。
 *
 * 编排层里也有同名的一张表（director/events.ts，横幅那句话要用）。两处各留一份是因为
 * 它们服务的是两个不同的东西：那边拼的是横幅文案，这边填的是结算层顶栏的类别药丸，
 * 而 cue 载荷里带的是 core 的枚举值，本来就该由用它的人各自翻译。
 * 真要合并，合并点应该是一份「界面文案表」（第 31 条重做文字界面时再说），不是互相 import。
 */
const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  meme: '梗题',
  bias: '刻板印象',
  life: '生活类',
}

/** 本轮那 1 分是怎么分出来的，底栏那句结论。文案抄旧版 RoundSettleLayer 的三档。 */
const VERDICT_LABELS: Record<RoundVerdict, string> = {
  'more-correct': '答对更多，本轮 +1',
  'fewer-tokens': '答对数持平，消耗更少者 +1',
  'equal-tokens': '答对数与消耗均持平，双方各 +1',
}

type SettleKind =
  | 'settle-open'
  | 'settle-row'
  | 'settle-answer'
  | 'settle-typing'
  | 'settle-stamp'
  | 'settle-counts'
  | 'settle-score'
  | 'settle-confirm'
  | 'settle-exit'

export const settlePlayers: CuePlayerGroup<SettleKind> = {
  'settle-open'(ctx, cue) {
    ctx.parts.settle.open(
      { category: CATEGORY_LABELS[cue.question.category], text: cue.question.text },
      cue.round,
      cue.scoresBefore,
    )
  },

  /**
   * 新增一张结果卡。
   *
   * 卡面身份读 cue 里的 cardId 而不是查视图：答错的那个单位马上就被罚下，回头查视图会查空
   *（编排层那边同一个理由，见 director/events.ts 的 AI_ANSWERED 分支）。
   */
  'settle-row'(ctx, cue) {
    const side: SettleSide = cue.mine ? 'mine' : 'theirs'
    const name = ctx.catalog.cards[cue.cardId]?.name ?? cue.cardId
    const card = ctx.makeCard(cue.cardId, `settle:${cue.instanceId}`)
    ctx.parts.settle.addRow(cue.instanceId, name, card, side)
  },

  'settle-answer'(ctx, cue) {
    ctx.parts.settle.revealAnswer(cue.answer, cue.explanation)
  },

  'settle-typing'(ctx, cue) {
    ctx.parts.settle.typeRow(cue.instanceId, cue.answer, cue.reasoning, cue.durationMs)
  },

  'settle-stamp'(ctx, cue) {
    ctx.parts.settle.stamp(cue.instanceId, cue.correct, cue.safePassed)
  },

  /** 两侧标头的「正确 x / N」，外加「本轮领先」徽章。答对一样多就谁都不领先。 */
  'settle-counts'(ctx, cue) {
    const { mine, theirs } = cue.correctCounts
    const leader: SettleSide | null = mine === theirs ? null : mine > theirs ? 'mine' : 'theirs'
    ctx.parts.settle.showCounts(mine, theirs, leader)
  },

  'settle-score'(ctx, cue) {
    ctx.parts.settle.showScore(cue.totals, cue.spent, VERDICT_LABELS[cue.verdict])
  },

  /**
   * 确认按钮淡入，落地那一刻才点得动（组件自己管这一下）。
   *
   * 点下去要发两样东西：先一条 `settle-confirm` 的用户操作（编排层据此把按钮改成
   * 「等对方」并停掉主线），再一条 `CONFIRM_ROUND` 指令。顺序不能反——
   * 指令的回包可能比本地状态先到，那时编排层还不知道玩家已经点过了。
   */
  'settle-confirm'(ctx) {
    ctx.parts.settle.enableConfirm(() => {
      ctx.userAction({ kind: 'settle-confirm' })
      ctx.command({ type: 'CONFIRM_ROUND', player: ctx.seat })
    })
  },

  'settle-exit'(ctx) {
    ctx.parts.settle.exit()
  },
}
