/**
 * 两档牌组编辑版式的几何断言。
 *
 * 版式只输出数（见 scenes/deck/layout/types.ts），所以这些性质不用起浏览器就查得了。
 * 查的是**两档各自都必须成立的那几条**：块与块不重叠、格数正好、卡在格子里放得下，
 * 以及两档真正分岔的那三处确实分岔了（列数、抽屉、卡的大小）。
 */

import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT, CARD_WIDTH } from '../src/layout/fanMath'
import { cellCount, gridSize } from '../src/layout/gridMath'
import { desktopLayout } from '../src/scenes/deck/layout/desktopLayout'
import { mobileLayout } from '../src/scenes/deck/layout/mobileLayout'
import { pickDeckLayout, pickDeckTier } from '../src/scenes/deck/layout/pickLayout'
import type { DeckLayout } from '../src/scenes/deck/layout/types'

const DESKTOP = desktopLayout(1280, 800)
const WIDE = desktopLayout(1920, 1080)
const MOBILE = mobileLayout(390, 844)

/** 两块矩形有没有重叠。 */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 网格整块在不在这块地方里（留一点浮点余量）。 */
function fitsIn(
  grid: ReturnType<typeof gridSize> & { x: number; y: number },
  area: { x: number; y: number; width: number; height: number },
): boolean {
  const slack = 0.5
  return (
    grid.x >= area.x - slack &&
    grid.y >= area.y - slack &&
    grid.x + grid.width <= area.x + area.width + slack &&
    grid.y + grid.height <= area.y + area.height + slack
  )
}

describe('挑档位', () => {
  it('判据和对局那边同一条：短边窄于断点，或者指针是粗的', () => {
    expect(pickDeckTier(1280, 800)).toBe('desktop')
    expect(pickDeckTier(390, 844)).toBe('mobile')
    // 手机横过来：宽过了断点，但短边只有 390。
    expect(pickDeckTier(844, 390)).toBe('mobile')
    // 大屏平板照样是手指在点。
    expect(pickDeckTier(1280, 800, true)).toBe('mobile')
    expect(pickDeckLayout(390, 844).tier).toBe('mobile')
  })
})

describe.each([
  ['桌面档 1280×800', DESKTOP],
  ['桌面档 1920×1080', WIDE],
  ['手机档 390×844', MOBILE],
])('%s', (_name, layout: DeckLayout) => {
  it('牌组那一栏正好 20 格', () => {
    expect(cellCount(layout.slots)).toBe(20)
  })

  it('卡池网格和牌组卡位都在各自那块地方里', () => {
    const poolGrid = { ...gridSize(layout.poolGrid), x: layout.poolGrid.x, y: layout.poolGrid.y }
    expect(fitsIn(poolGrid, layout.pool)).toBe(true)
    const slotGrid = { ...gridSize(layout.slots), x: layout.slots.x, y: layout.slots.y }
    expect(fitsIn(slotGrid, layout.side)).toBe(true)
  })

  it('顶栏之下才是正文，卡池不压在顶栏上', () => {
    expect(layout.pool.y).toBeGreaterThanOrEqual(layout.topBarHeight)
  })

  it('格子是 2:3，卡按缩放放进去正好', () => {
    expect(layout.poolGrid.cellHeight / layout.poolGrid.cellWidth).toBeCloseTo(
      CARD_HEIGHT / CARD_WIDTH,
      5,
    )
    expect(layout.poolCardScale * CARD_WIDTH).toBeCloseTo(layout.poolGrid.cellWidth, 5)
    expect(layout.slotCardScale * CARD_WIDTH).toBeCloseTo(layout.slots.cellWidth, 5)
  })

  it('提示条压在底板底边，翻页行排在它上面', () => {
    expect(layout.poolHint.y + layout.poolHint.height).toBeCloseTo(
      layout.pool.y + layout.pool.height,
      5,
    )
    expect(layout.pager.label.y).toBeLessThan(layout.poolHint.y)
  })
})

describe('桌面档：左卡池右牌组栏', () => {
  it('两块并排，一点都不重叠', () => {
    expect(overlaps(DESKTOP.pool, DESKTOP.side)).toBe(false)
    expect(DESKTOP.pool.x + DESKTOP.pool.width).toBeLessThanOrEqual(DESKTOP.side.x)
  })

  it('牌组栏一直摊着，没有抽屉', () => {
    expect(DESKTOP.drawer).toBeNull()
  })

  it('卡池一页 4 列 × 2 行 = 8 张，牌组栏 2 列 × 10 行', () => {
    expect(DESKTOP.poolGrid.columns).toBe(4)
    expect(DESKTOP.poolGrid.rows).toBe(2)
    expect(DESKTOP.slots.columns).toBe(2)
    expect(DESKTOP.slots.rows).toBe(10)
  })

  it('屏幕越宽卡池越宽，牌组栏封顶不再长', () => {
    expect(WIDE.pool.width).toBeGreaterThan(DESKTOP.pool.width)
    expect(WIDE.side.width).toBeLessThanOrEqual(460)
  })
})

describe('手机档：上卡池下抽屉', () => {
  it('卡池一页 3 列 × 2 行 = 6 张，抽屉里 4 列 × 5 行', () => {
    expect(MOBILE.poolGrid.columns).toBe(3)
    expect(MOBILE.poolGrid.rows).toBe(2)
    expect(MOBILE.slots.columns).toBe(4)
    expect(MOBILE.slots.rows).toBe(5)
  })

  it('收起来那一条贴着屏幕底边，且不挡住卡池', () => {
    const drawer = MOBILE.drawer
    if (drawer === null) throw new Error('手机档必须有抽屉')
    expect(drawer.collapsed.y + drawer.collapsed.height).toBe(844)
    expect(overlaps(MOBILE.pool, drawer.collapsed)).toBe(false)
  })

  it('展开之后比收起来高得多，而且确实盖住了卡池——它是一块浮层', () => {
    const drawer = MOBILE.drawer
    if (drawer === null) throw new Error('手机档必须有抽屉')
    expect(drawer.expanded.height).toBeGreaterThan(drawer.collapsed.height)
    expect(overlaps(MOBILE.pool, drawer.expanded)).toBe(true)
  })

  it('收起来就是整层往下挪 drawerOffset，正好露出最上面那一条', () => {
    const drawer = MOBILE.drawer
    if (drawer === null) throw new Error('手机档必须有抽屉')
    expect(MOBILE.drawerOffset).toBe(drawer.expanded.height - drawer.collapsed.height)
    expect(drawer.expanded.y + MOBILE.drawerOffset).toBe(drawer.collapsed.y)
    // 桌面档一直摊着，没有这一说。
    expect(DESKTOP.drawerOffset).toBe(0)
  })

  it('计数和进度条排在最上面：收起来时露出来的就是它们', () => {
    const drawer = MOBILE.drawer
    if (drawer === null) throw new Error('手机档必须有抽屉')
    const bottom = drawer.collapsed.y + drawer.collapsed.height
    for (const y of [MOBILE.tally.y, MOBILE.progress.y]) {
      expect(y + MOBILE.drawerOffset).toBeGreaterThanOrEqual(drawer.collapsed.y)
      expect(y + MOBILE.drawerOffset).toBeLessThan(bottom)
    }
    // 页签和卡位排在它们下面，收起来之后就掉到屏幕外了。
    expect(MOBILE.tabs.y).toBeGreaterThan(MOBILE.progress.y)
    expect(MOBILE.slots.y).toBeGreaterThan(MOBILE.tabs.y)
  })

  it('卡比桌面档小一档：格子窄，缩放也跟着小', () => {
    expect(MOBILE.poolGrid.cellWidth).toBeLessThan(DESKTOP.poolGrid.cellWidth)
    expect(MOBILE.poolCardScale).toBeLessThan(DESKTOP.poolCardScale)
  })

  it('放大查看放得更大：手指按住的那块地方本来就挡掉一片', () => {
    expect(MOBILE.revealScale).toBeGreaterThan(DESKTOP.revealScale)
  })
})
