/**
 * 两档牌组编辑版式的几何断言。
 *
 * 版式只输出数（见 scenes/deck/layout/types.ts），所以这些性质不用起浏览器就查得了。
 * 查的是**两档各自都必须成立的那几条**：块与块不重叠、格数正好、卡在格子里放得下，
 * 以及两档真正分岔的那几处确实分岔了（卡池怎么翻、牌组栏是一整条还是抽屉、卡多大）。
 *
 * 桌面档是 1672×941 的死版式整块缩放，所以那一档的矩形**和视口无关**：
 * 1280×800 和 1920×1080 算出来的每一个数都一样，只有 `stage.scale` 不同。
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

/** 设计稿尺寸。桌面档的每一个矩形都在这块舞台里。 */
const DESIGN = { width: 1672, height: 941 }

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
  it('判据和对局那边同一条：宽窄于断点，或者指针是粗的', () => {
    expect(pickDeckTier(1280)).toBe('desktop')
    expect(pickDeckTier(390)).toBe('mobile')
    // 手机横过来（844×390）宽过了断点，靠「指针是粗的」那条进手机档，不靠短边。
    expect(pickDeckTier(844, true)).toBe('mobile')
    // 大屏平板照样是手指在点。
    expect(pickDeckTier(1280, true)).toBe('mobile')
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

  it('卡池和牌组卡位都在各自那块地方里（滚动那一档看的是窗口）', () => {
    const poolArea = layout.poolScroll?.view ?? layout.pool
    const poolGrid = {
      ...gridSize({ ...layout.poolGrid, rows: 1 }),
      x: layout.poolGrid.x,
      y: layout.poolGrid.y,
    }
    // 横向要塞得进去（纵向滚动那一档内容比窗口高，那是应该的）。
    expect(poolGrid.x + poolGrid.width).toBeLessThanOrEqual(poolArea.x + poolArea.width + 0.5)
    expect(fitsIn({ ...poolArea }, layout.pool)).toBe(true)
    const slotArea = layout.slotScroll?.view ?? layout.side
    const slotRow = {
      ...gridSize({ ...layout.slots, rows: 1 }),
      x: layout.slots.x,
      y: layout.slots.y,
    }
    expect(slotRow.x + slotRow.width).toBeLessThanOrEqual(slotArea.x + slotArea.width + 0.5)
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

  it('提示条压在底板底边', () => {
    expect(layout.poolHint.y + layout.poolHint.height).toBeCloseTo(
      layout.pool.y + layout.pool.height,
      5,
    )
  })

  it('卡池要么翻页要么滚动，不会两样都有、也不会两样都没有', () => {
    expect(layout.pager === null).toBe(layout.poolScroll !== null)
  })
})

describe('桌面档：1672×941 死版式 + 两块纵向滚动区', () => {
  it('两块并排，一点都不重叠', () => {
    expect(overlaps(DESKTOP.pool, DESKTOP.side)).toBe(false)
    expect(DESKTOP.pool.x + DESKTOP.pool.width).toBeLessThanOrEqual(DESKTOP.side.x)
  })

  it('牌组栏一直摊着，没有抽屉', () => {
    expect(DESKTOP.drawer).toBeNull()
  })

  it('舞台恒是设计稿那么大，换视口只换缩放比和偏移', () => {
    expect(DESKTOP.width).toBe(DESIGN.width)
    expect(DESKTOP.height).toBe(DESIGN.height)
    // 每一个矩形都和视口无关：1280×800 和 1920×1080 算出来一模一样。
    expect(WIDE.pool).toEqual(DESKTOP.pool)
    expect(WIDE.side).toEqual(DESKTOP.side)
    expect(WIDE.poolGrid).toEqual(DESKTOP.poolGrid)
    expect(WIDE.slots).toEqual(DESKTOP.slots)
    // 1280/1672 = 0.7656…，1920/1672 被 1080/941 截住 = 1.1477…
    expect(DESKTOP.stage.scale).toBeCloseTo(1280 / DESIGN.width, 5)
    expect(WIDE.stage.scale).toBeCloseTo(1080 / DESIGN.height, 5)
    // 缩放之后整块居中。
    expect(DESKTOP.stage.y).toBeCloseTo((800 - DESIGN.height * DESKTOP.stage.scale) / 2, 5)
    expect(WIDE.stage.x).toBeCloseTo((1920 - DESIGN.width * WIDE.stage.scale) / 2, 5)
  })

  it('两栏宽度照黑客松那条推导：右栏 496，卡池 1096', () => {
    expect(DESKTOP.side.width).toBe(496)
    expect(DESKTOP.pool.width).toBe(1096)
  })

  it('卡池 4 列、列宽 249.5（= 150 × 1.6633）', () => {
    expect(DESKTOP.poolGrid.columns).toBe(4)
    expect(DESKTOP.poolGrid.cellWidth).toBeCloseTo(249.5, 5)
    expect(DESKTOP.poolCardScale).toBeCloseTo(1.6633, 4)
  })

  it('牌组栏 2 列 × 10 行、格 206×309（= 150 × 1.3733）', () => {
    expect(DESKTOP.slots.columns).toBe(2)
    expect(DESKTOP.slots.rows).toBe(10)
    expect(DESKTOP.slots.cellWidth).toBeCloseTo(206, 5)
    expect(DESKTOP.slots.cellHeight).toBeCloseTo(309, 5)
    expect(DESKTOP.slotCardScale).toBeCloseTo(1.3733, 4)
  })

  it('两块都真的要滚：内容比窗口高，而滚动条摆在窗口右边、不压着格子', () => {
    const pool = DESKTOP.poolScroll
    const slot = DESKTOP.slotScroll
    if (pool === null || slot === null) throw new Error('桌面档两块都该滚动')
    // 一屏看得见不到两行卡池（黑客松实测「只看得见 8 张」）。
    expect(pool.view.height).toBeLessThan(DESKTOP.poolGrid.cellHeight * 2)
    // 20 格排成 2 列就是 10 行，远高于窗口。
    expect(DESKTOP.slots.cellHeight * 10).toBeGreaterThan(slot.view.height * 4)
    expect(pool.bar.width).toBe(8)
    expect(pool.bar.x).toBeGreaterThanOrEqual(pool.view.x + pool.view.width)
    expect(slot.bar.x).toBeGreaterThanOrEqual(slot.view.x + slot.view.width)
  })

  it('筛选栏两行：阵营药丸另起一行靠左，不再挤在种类页签右端', () => {
    expect(DESKTOP.poolFactions.y).toBeGreaterThan(DESKTOP.poolKinds.y)
    expect(DESKTOP.poolFactions.x).toBe(DESKTOP.poolKinds.x)
  })

  it('卡位不至于小到看不出是哪张牌', () => {
    // 60 像素上卡面的铭牌还认得出字。再窄就该改行列数，不是硬塞。
    expect(DESKTOP.slots.cellWidth).toBeGreaterThan(60)
    expect(MOBILE.slots.cellWidth).toBeGreaterThan(60)
  })
})

describe('手机档：上卡池下抽屉（这一条一个数都没改）', () => {
  it('不缩放：舞台就是视口', () => {
    expect(MOBILE.width).toBe(390)
    expect(MOBILE.stage).toEqual({ scale: 1, x: 0, y: 0 })
    expect(MOBILE.poolScroll).toBeNull()
    expect(MOBILE.slotScroll).toBeNull()
  })

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

  it('翻页行排在提示条上面', () => {
    const pager = MOBILE.pager
    if (pager === null) throw new Error('手机档必须有翻页')
    expect(pager.label.y).toBeLessThan(MOBILE.poolHint.y)
  })

  it('放大查看放得更大：手指按住的那块地方本来就挡掉一片', () => {
    expect(MOBILE.revealScale).toBeGreaterThan(DESKTOP.revealScale)
  })
})
