/**
 * 两档对局版式：挑哪一档，以及各自的几何。
 *
 * 需求第 3 条要求两档并列、不做整体缩放，所以这里断言的重点是**两档真的不一样**
 *（侧栏折叠、战场缩一档、手牌区更高），而不是各字段的具体数值——那些数会随美术调整变，
 * 钉死了只会变成一份要跟着改的副本。真正钉死的是那几条不能破的关系：
 * 手牌不压到战场、出牌区够得着、各块都在视口里。
 */

import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT } from '../src/layout/fanMath'
import { desktopLayout } from '../src/scenes/duel/layout/desktopLayout'
import { mobileLayout } from '../src/scenes/duel/layout/mobileLayout'
import { pickLayout, pickTier, TOUCH_BREAKPOINT } from '../src/scenes/duel/layout/pickLayout'
import type { DuelLayout } from '../src/scenes/duel/layout/types'

/** 两档各取一个有代表性的视口：一台 1080p 显示器，一部 iPhone。 */
const DESKTOP = { width: 1920, height: 1080 }
const MOBILE = { width: 390, height: 844 }

/** 扇形最上沿：卡的原点在底边中点，所以整排最高只到锚点上方一张卡。 */
function fanTop(layout: DuelLayout): number {
  return layout.hand.y - CARD_HEIGHT * layout.hand.scale
}

describe('挑哪一档版式', () => {
  it('大屏走桌面档，小屏走手机档', () => {
    expect(pickTier(DESKTOP.width, DESKTOP.height)).toBe('desktop')
    expect(pickTier(MOBILE.width, MOBILE.height)).toBe('mobile')
  })

  it('指针是粗的就一律走手机档，屏幕再大也一样', () => {
    // 大屏平板照样是手指在点：热区和手牌区要按触屏来，这和屏幕多大无关。
    expect(pickTier(DESKTOP.width, DESKTOP.height, true)).toBe('mobile')
  })

  it('看的是短边不是宽', () => {
    // 手机横过来宽度过了断点，但高只有 390，竖着排的那几块照样挤不下。
    expect(pickTier(MOBILE.height, MOBILE.width)).toBe('mobile')
    expect(pickTier(TOUCH_BREAKPOINT, TOUCH_BREAKPOINT)).toBe('desktop')
    expect(pickTier(TOUCH_BREAKPOINT, TOUCH_BREAKPOINT - 1)).toBe('mobile')
  })

  it('pickLayout 给出的就是对应那一档的版式', () => {
    expect(pickLayout(DESKTOP.width, DESKTOP.height).tier).toBe('desktop')
    expect(pickLayout(MOBILE.width, MOBILE.height).tier).toBe('mobile')
  })
})

describe('两档真的分岔了', () => {
  const desktop = desktopLayout(DESKTOP.width, DESKTOP.height)
  const mobile = mobileLayout(MOBILE.width, MOBILE.height)

  it('侧栏在手机档折叠成一行', () => {
    expect(desktop.sideBar).not.toBeNull()
    expect(desktop.panelRow).toBeNull()
    expect(mobile.sideBar).toBeNull()
    expect(mobile.panelRow).not.toBeNull()
  })

  it('折叠出来那一行装得下并排的两块面板', () => {
    const row = mobile.panelRow
    expect(row).not.toBeNull()
    if (row === null) return
    const each = (row.width - row.gap) / 2
    expect(each).toBeGreaterThan(0)
    expect(row.x + row.width).toBeLessThanOrEqual(mobile.width)
  })

  it('战场在手机档缩一档，桌面档不缩', () => {
    expect(desktop.board.scale).toBe(1)
    expect(mobile.board.scale).toBeLessThan(1)
  })

  it('手牌区在手机档更高，顶栏更矮', () => {
    // 「手牌区多高」在版式里没有单独的字段，看的是扇形锚点离战场下沿留了多少。
    const desktopZone = desktop.height - (desktop.board.y + desktop.board.height)
    const mobileZone = mobile.height - (mobile.board.y + mobile.board.height)
    expect(mobileZone / mobile.height).toBeGreaterThan(desktopZone / desktop.height)
    expect(mobile.topBarHeight).toBeLessThan(desktop.topBarHeight)
  })

  it('放大查看在触屏档放得更大', () => {
    expect(mobile.revealScale).toBeGreaterThan(desktop.revealScale)
  })
})

describe.each([
  ['桌面档', desktopLayout(DESKTOP.width, DESKTOP.height)],
  ['手机档', mobileLayout(MOBILE.width, MOBILE.height)],
])('%s 的几何', (_name, layout) => {
  it('手牌不压到战场', () => {
    expect(layout.board.y + layout.board.height).toBeLessThanOrEqual(fanTop(layout))
  })

  it('出牌区的下沿和手牌锚点拉开至少半张卡', () => {
    // 贴着手牌的话，指针刚把牌抬起来一点就越线了。
    const gap = layout.hand.y - (layout.dropZone.y + layout.dropZone.height)
    expect(gap).toBeGreaterThanOrEqual((CARD_HEIGHT * layout.hand.scale) / 2)
  })

  it('出牌区盖得住整个战场', () => {
    expect(layout.dropZone.y).toBeLessThanOrEqual(layout.board.y)
    expect(layout.dropZone.x).toBeLessThanOrEqual(layout.board.x)
    expect(layout.dropZone.x + layout.dropZone.width).toBeGreaterThanOrEqual(
      layout.board.x + layout.board.width,
    )
  })

  it('各块都在视口里', () => {
    expect(layout.board.x).toBeGreaterThanOrEqual(0)
    expect(layout.board.x + layout.board.width).toBeLessThanOrEqual(layout.width)
    expect(layout.board.height).toBeGreaterThan(0)
    expect(layout.deck.x).toBeGreaterThan(0)
    expect(layout.deck.x).toBeLessThan(layout.width)
    expect(layout.endPlay.x).toBeLessThan(layout.width)
    expect(layout.endPlay.y).toBeLessThan(layout.height)
  })

  // 两颗钮不同时出现，所以摞在同一个位置上（见 layout/types.ts 的 `urge`）。
  // 哪天有人给「催一催」单独算了一个位置，这条会当场红。
  it('「催一催」和「结束出牌」在同一个位置上', () => {
    expect(layout.urge).toEqual(layout.endPlay)
  })

  it('战场在顶栏下面，不被它盖住', () => {
    expect(layout.board.y).toBeGreaterThanOrEqual(layout.topBarHeight)
  })
})
