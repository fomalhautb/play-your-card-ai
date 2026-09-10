/**
 * 「这一局怎么收场的」那两个纯函数。
 *
 * 值得单独测是因为它们错了要打完一整局才看得见：胜负判的是「赢家等于本方座位号」，
 * 而 `winner` 还可能是 `'draw'` 或 `null`，写成「不等于对方就是赢」的话，
 * 平局和没打完都会被报成胜利，还会跟着刷一次胜场。
 */

import type { PlayerView } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import type { MatchStatus, MatchView } from '../src/match/driver'
import { outcomeOf, resultTitleOf } from '../src/screens/matchOutcome'

/** 一份只填了这几个函数会读的字段的视图。其余字段它们一个都不看。 */
function matchView(
  status: MatchStatus,
  winner: PlayerView['winner'],
  extra: Partial<MatchView> = {},
): MatchView {
  return {
    view: winner === undefined ? null : ({ winner } as PlayerView),
    seat: 0,
    status,
    lastRejection: null,
    abortReason: null,
    link: 'ok',
    peer: null,
    ...extra,
  }
}

describe('判收场', () => {
  it('还在打就是 null，不该盖结算层', () => {
    expect(outcomeOf(matchView('playing', null))).toBe(null)
    expect(outcomeOf(matchView('connecting', null))).toBe(null)
  })

  it('赢家等于本方座位才是胜利', () => {
    expect(outcomeOf(matchView('finished', 0))).toBe('victory')
    expect(outcomeOf(matchView('finished', 1))).toBe('defeat')
    // 换个座位，同一个赢家就该换个结论。
    expect(outcomeOf({ ...matchView('finished', 1), seat: 1 })).toBe('victory')
  })

  it('平局不是胜利也不是失败', () => {
    expect(outcomeOf(matchView('finished', 'draw'))).toBe('draw')
  })

  it('打完了却没有赢家当平局处理', () => {
    // 规则上不该出现（引擎收场时一定会填），当成失败会平白扣掉一次胜场。
    expect(outcomeOf(matchView('finished', null))).toBe('draw')
  })

  it('中断和结束是两回事', () => {
    expect(outcomeOf(matchView('aborted', 0))).toBe('aborted')
    // 中断时连视图都可能还没有。
    expect(outcomeOf({ ...matchView('aborted', null), view: null })).toBe('aborted')
  })

  it('说是打完了却没有视图，先不下结论', () => {
    expect(outcomeOf({ ...matchView('finished', 0), view: null })).toBe(null)
  })
})

describe('结算层的大标题', () => {
  it('三种结局各一句', () => {
    expect(resultTitleOf('victory', null)).toBe('你赢了')
    expect(resultTitleOf('defeat', null)).toBe('你输了')
    expect(resultTitleOf('draw', null)).toBe('平局')
  })

  it('中断显示服务端给的原因', () => {
    expect(resultTitleOf('aborted', '对手离开了房间')).toBe('对手离开了房间')
  })

  it('没给原因就退回一句通用的', () => {
    // 一个字都没有的标题比一句笼统的话更糟。
    expect(resultTitleOf('aborted', null)).toBe('对局中断')
    expect(resultTitleOf('aborted', '')).toBe('对局中断')
  })
})
