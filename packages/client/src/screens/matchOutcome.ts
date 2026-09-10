/**
 * 「这一局到底怎么收场的」——从 `MatchView` 判出胜负和那句大标题。
 *
 * 单独拎成纯函数是因为这里有两处很容易写错，而写错了要打完一整局才看得见：
 * 1. 胜负判的是「赢家等于本方座位号」，不是「不等于对方」——`winner` 还可能是 `'draw'`
 *    或 `null`（没打完），那两种都不是胜利。
 * 2. 中断（`aborted`）和结束（`finished`）是两回事：中断没有赢家，也没有比分可言。
 */

import type { MatchView } from '../match/driver'
import type { MatchOutcome } from './MatchResult'

/** 这一局收场了没有；还在打就是 null，那时不该盖结算层。 */
export function outcomeOf(view: MatchView): MatchOutcome | null {
  if (view.status === 'aborted') return 'aborted'
  if (view.status !== 'finished' || view.view === null) return null
  const winner = view.view.winner
  if (winner === 'draw') return 'draw'
  return winner === view.seat ? 'victory' : 'defeat'
}

/**
 * 结算层上那行大字。
 *
 * 中断时显示中断原因（服务端给的那句话，玩家看得懂）；服务端没写原因就退回一句通用的——
 * 一个字都没有的标题比一句笼统的话更糟。
 */
export function resultTitleOf(outcome: MatchOutcome, abortReason: string | null): string {
  switch (outcome) {
    case 'victory':
      return '你赢了'
    case 'defeat':
      return '你输了'
    case 'draw':
      return '平局'
    case 'aborted':
      return abortReason === null || abortReason.length === 0 ? '对局中断' : abortReason
  }
}
