/**
 * 回合结算层的四段时间线，抄自旧版 `RoundSettleLayer.tsx` 的四段 `useGSAP`：
 * ①整层入场 ②每来一条答题结果就添一张卡 ③计分到了才起跑的主线 ④阶段翻篇后退场。
 *
 * 碰的是 context 的 `settle` 和闸门 `quizUp`。
 *
 * 主线用**绝对时刻**串，不用「上一段完了接下一段」：逐卡打字每张卡的长短都不一样
 *（答案和推理按字数算），只有把结束时刻一路算出来，后面盖章、底栏那几拍才接得准。
 *
 * 逐卡开口的间隔是随机的（旧版 `Math.random()`），这里改成注入的定种子随机数：
 * 同一局重放两遍得到的 cue 序列必须逐条相同，否则快照测试没法比。
 */

import type { InstanceId, PublicQuestion, RoundVerdict } from '@ai-duel/core'
import { pumpBanner } from './banner'
import type { DirectorContext, SettleRow } from './context'
import type { CueSides } from './cues'
import { releaseDeal } from './deal'
import {
  SETTLE_ANSWER_CHAR_MS,
  SETTLE_ANSWER_MS,
  SETTLE_CARD_STAGGER_MAX_MS,
  SETTLE_CARD_STAGGER_MIN_MS,
  SETTLE_CONFIRM_MS,
  SETTLE_COUNTS_MS,
  SETTLE_EXIT_MS,
  SETTLE_LOADER_EXTRA_MS,
  SETTLE_LOADER_FADE_MS,
  SETTLE_OPEN_MS,
  SETTLE_READ_HOLD_MS,
  SETTLE_REASONING_CHAR_MS,
  SETTLE_REASONING_MAX_MS,
  SETTLE_ROW_IN_MS,
  SETTLE_ROW_STAGGER_MS,
  SETTLE_SCORE_MS,
  SETTLE_STAMP_MS,
  SETTLE_STAMP_STAGGER_MS,
} from './timings'

/** 主线要用的那份计分结果，全部换算成「我方 / 对方」。 */
export interface SettleScore {
  correctCounts: CueSides
  gains: CueSides
  totals: CueSides
  spent: CueSides
  verdict: RoundVerdict
  /** 本轮标准答案，本轮结算之后才公开，从视图里取（事件上的那份要过裁剪）。 */
  answer: string
  explanation: string
}

/** 排一件主线上的事，同时登记进去，退场时要整条掐掉。 */
function later(context: DirectorContext, delayMs: number, run: () => void): void {
  const settle = context.settle
  if (settle === null) return
  settle.tasks.push(context.schedule(delayMs, run))
}

/** ①整层立起来：题面亮出，双方的结果卡位摆好。 */
export function openSettle(
  context: DirectorContext,
  info: { round: number; question: PublicQuestion; scoresBefore: CueSides },
): void {
  // 上一层要是还没退干净（正常路径不会，中途接手时可能），它排下的东西一条都不该跟到新的一轮。
  for (const task of context.settle?.tasks ?? []) task.cancel()
  context.quizUp = true
  context.settle = {
    openedAt: context.now,
    round: info.round,
    question: info.question,
    rows: [],
    tasks: [],
    ready: false,
    confirmed: false,
    exiting: false,
  }
  context.emit({
    kind: 'settle-open',
    durationMs: SETTLE_OPEN_MS,
    round: info.round,
    question: info.question,
    scoresBefore: info.scoresBefore,
  })
  context.emit({ kind: 'tutorial', durationMs: 0, cue: 'quiz-open' })
}

/**
 * ②添一张结果卡。先只有卡名和「作答中」转圈，答案要等主线点名。
 *
 * 同一轮的 `AI_ANSWERED` 是一批送到的，所以逐张错开的下标直接按已有行数算。
 */
export function addSettleRow(context: DirectorContext, row: SettleRow): void {
  const settle = context.settle
  if (settle === null) return
  settle.rows.push(row)
  const index = settle.rows.length - 1
  const emitRow = () => {
    context.emit({
      kind: 'settle-row',
      durationMs: SETTLE_ROW_IN_MS,
      instanceId: row.instanceId,
      cardId: row.cardId,
      mine: row.mine,
      correct: row.correct,
    })
  }
  if (index === 0) emitRow()
  else later(context, index * SETTLE_ROW_STAGGER_MS, emitRow)
}

/**
 * 给某一行打上「保送」。
 *
 * 这一下没有当场的演出：卡还是按「答错」画，那枚「保送留场」要等主线盖完判定章才补上
 *（见下面的盖章那一拍）。
 */
export function markSafePassed(context: DirectorContext, instanceId: InstanceId): void {
  const row = context.settle?.rows.find((item) => item.instanceId === instanceId)
  if (row !== undefined) row.safePassed = true
}

/** 一张结果卡开口作答要多久：转圈淡出 + 大字答案打字 + 小字推理打字。 */
function typingDuration(row: SettleRow): number {
  const answerMs = row.answer.length * SETTLE_ANSWER_CHAR_MS
  const reasoningMs = Math.min(
    row.reasoning.length * SETTLE_REASONING_CHAR_MS,
    SETTLE_REASONING_MAX_MS,
  )
  return SETTLE_LOADER_FADE_MS + answerMs + reasoningMs
}

/**
 * ③主线：计分事件到了才起跑，整条线的节拍全排在这里。
 *
 * 读题的等待是「还差多少」不是「再等四秒」：服务端自动交卷（2.5 秒）比读题时间早到，
 * 主线只补上剩下的那一段；晚到就立刻开演。
 */
export function startSettleMain(context: DirectorContext, score: SettleScore): void {
  const settle = context.settle
  if (settle === null) return
  const rows = settle.rows
  const elapsed = context.now - settle.openedAt
  let at = Math.max(0, SETTLE_READ_HOLD_MS - elapsed)

  // ① 标准答案擦入：面板从左往右揭开。
  later(context, at, () => {
    context.emit({
      kind: 'settle-answer',
      durationMs: SETTLE_ANSWER_MS,
      answer: score.answer,
      explanation: score.explanation,
    })
  })
  at += SETTLE_ANSWER_MS

  // ② 逐卡作答。起跑线整体后移一拍让转圈多转一会儿，随后每张卡按各自的随机间隔依次开口。
  let cardStart = at + SETTLE_LOADER_EXTRA_MS
  let answersEnd = at
  rows.forEach((row, index) => {
    if (index > 0) {
      cardStart += Math.round(
        context.rng.range(SETTLE_CARD_STAGGER_MIN_MS, SETTLE_CARD_STAGGER_MAX_MS),
      )
    }
    const durationMs = typingDuration(row)
    later(context, cardStart, () => {
      context.emit({
        kind: 'settle-typing',
        durationMs,
        instanceId: row.instanceId,
        answer: row.answer,
        reasoning: row.reasoning,
      })
    })
    answersEnd = Math.max(answersEnd, cardStart + durationMs)
  })
  at = answersEnd

  // ③ 判定章逐张盖下。被保送的那张紧接着还要补一枚「保送留场」，所以时长翻一倍。
  const stampStart = at
  rows.forEach((row, index) => {
    later(context, stampStart + index * SETTLE_STAMP_STAGGER_MS, () => {
      context.emit({
        kind: 'settle-stamp',
        durationMs: row.safePassed ? SETTLE_STAMP_MS * 2 : SETTLE_STAMP_MS,
        instanceId: row.instanceId,
        correct: row.correct,
        safePassed: row.safePassed,
      })
    })
  })
  at = stampStart + Math.max(0, rows.length - 1) * SETTLE_STAMP_STAGGER_MS + SETTLE_STAMP_MS
  // 逐张揭晓到此为止。教程等的就是这一拍——再早说话会压在还在打字的卡上。
  later(context, at, () => {
    context.emit({ kind: 'tutorial', durationMs: 0, cue: 'quiz-rows-done' })
  })

  // ④ 两侧标头的「正确 x / N」淡入，「本轮领先」徽章弹一下。
  later(context, at, () => {
    context.emit({
      kind: 'settle-counts',
      durationMs: SETTLE_COUNTS_MS,
      correctCounts: score.correctCounts,
    })
  })
  at += SETTLE_COUNTS_MS

  // ⑤ 底栏：先交代消耗，再落下结论，最后顶栏比分才跳。
  // 顺序是有讲究的——比分跳动是这一层的句号，它得排在「凭什么」讲完之后。
  later(context, at, () => {
    context.emit({
      kind: 'settle-score',
      durationMs: SETTLE_SCORE_MS,
      gains: score.gains,
      totals: score.totals,
      spent: score.spent,
      verdict: score.verdict,
    })
  })
  at += SETTLE_SCORE_MS
  later(context, at, () => {
    context.emit({ kind: 'tutorial', durationMs: 0, cue: 'quiz-score-shown' })
  })

  // ⑥ 按钮淡入，落地那一刻才解锁。
  later(context, at, () => {
    context.emit({ kind: 'settle-confirm', durationMs: SETTLE_CONFIRM_MS })
  })
  at += SETTLE_CONFIRM_MS
  later(context, at, () => {
    if (context.settle !== null) context.settle.ready = true
  })
}

/** 玩家点了确认。按钮当场失效，等对方也确认之后阶段才会翻篇。 */
export function confirmSettle(context: DirectorContext): boolean {
  const settle = context.settle
  if (settle === null || !settle.ready || settle.confirmed) return false
  settle.confirmed = true
  settle.ready = false
  return true
}

/**
 * ④退场：阶段离开 quiz / settle 就说明这一轮翻篇了（双方都确认，进下一轮或终局）。
 *
 * 退场先把主线整条掐掉：结果卡可能还在打字，整层已经在淡出了，那些补间没有意义。
 * 退完才轮到憋着的横幅和补牌——它们让的正是这一层。
 */
export function exitSettle(context: DirectorContext): void {
  const settle = context.settle
  if (settle === null || settle.exiting) return
  settle.exiting = true
  for (const task of settle.tasks) task.cancel()
  settle.tasks = []
  context.emit({ kind: 'settle-exit', durationMs: SETTLE_EXIT_MS })
  context.schedule(SETTLE_EXIT_MS, () => {
    context.quizUp = false
    context.settle = null
    // 结算层退场了，教程的提示这才有地方站（它比这一层低一档）。
    context.emit({ kind: 'tutorial', durationMs: 0, cue: 'quiz-closed' })
    // 结算层立着的这段时间里憋下的横幅（下一轮的宣告），到这里才放出来。
    pumpBanner(context)
    // 屏幕空出来了，这一轮的补牌这才从各自的卡堆飞出去。
    releaseDeal(context)
  })
}
