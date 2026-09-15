/**
 * 选英雄页两档版式的几何断言（`scenes/hero/heroLayout.ts`）。
 *
 * 守两件事：
 *
 * - 桌面档是 1672×941 的**死版式**整块缩放，所以那一档的矩形**和视口无关**：
 *   1280×900 和 1920×1080 算出来的每一个数都一样，只有 `stage` 不同。下面几条照
 *   黑客松 `screens/hero.css` 的读数逐个对（卡 12.5cqi = 209、列距 3.33cqi、
 *   行距 2.4cqi、首行 19%）——改版式时这几条会先红。
 * - 两档是并列的两套摆法，不是缩放（需求第 3 条）：桌面 4 + 3，手机 3 + 2 + 2。
 *
 * 版式只输出数，所以这些断言不用起浏览器（和首页、对局那几档的测试同一个理由）。
 */

import { describe, expect, it } from 'vitest'
import { type HeroRect, pickHeroLayout } from '../src/scenes/hero/heroLayout'

/** 桌面档取两个比例不同的视口（死版式下两份结果必须一样），手机那档是 iPhone 竖屏。 */
const DESKTOP = { width: 1280, height: 900 }
const WIDE = { width: 1920, height: 1080 }
const MOBILE = { width: 390, height: 844 }

/** 设计稿尺寸，以及黑客松那一版的长度单位。 */
const DESIGN = { width: 1672, height: 941 }
const CQI = DESIGN.width / 100

function inside(rect: HeroRect, width: number, height: number): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height
  )
}

/** 两块矩形有没有叠在一起。 */
function overlaps(a: HeroRect, b: HeroRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 把一串卡按 y 分成若干排。同一排的 y 完全相等（版式是一排一排摆下去的）。 */
function groupRows(cards: readonly HeroRect[]): HeroRect[][] {
  const rows: HeroRect[][] = []
  for (const card of cards) {
    const row = rows[rows.length - 1]
    if (row !== undefined && row[0]!.y === card.y) row.push(card)
    else rows.push([card])
  }
  return rows
}

describe('选英雄页桌面档', () => {
  const layout = pickHeroLayout(DESKTOP.width, DESKTOP.height)

  it('舞台是 1672×941 的死版式，整块等比缩放居中', () => {
    expect(layout.tier).toBe('desktop')
    expect({ width: layout.width, height: layout.height }).toEqual(DESIGN)
    const scale = Math.min(DESKTOP.width / DESIGN.width, DESKTOP.height / DESIGN.height)
    expect(layout.stage.scale).toBeCloseTo(scale, 10)
    expect(layout.stage.x).toBeCloseTo((DESKTOP.width - DESIGN.width * scale) / 2, 10)
    expect(layout.stage.y).toBeCloseTo((DESKTOP.height - DESIGN.height * scale) / 2, 10)
  })

  it('换视口只换 stage，舞台里的每一个矩形一个数都不变', () => {
    const wide = pickHeroLayout(WIDE.width, WIDE.height)
    expect(wide.cards).toEqual(layout.cards)
    expect(wide.title).toEqual(layout.title)
    expect(wide.subtitle).toEqual(layout.subtitle)
    expect(wide.back).toEqual(layout.back)
    expect(wide.detail).toEqual(layout.detail)
    expect(wide.stage.scale).not.toBeCloseTo(layout.stage.scale, 3)
  })

  it('4 + 3 两排，尺寸和间距照 hero.css', () => {
    const rows = groupRows(layout.cards)
    expect(rows.map((row) => row.length)).toEqual([4, 3])
    const first = rows[0]!
    // 卡 12.5cqi，2:3。
    expect(first[0]!.width).toBeCloseTo(12.5 * CQI, 10)
    expect(first[0]!.height).toBeCloseTo(12.5 * CQI * 1.5, 10)
    // 列距 3.33cqi、行距 2.4cqi、首行上沿 19%。
    expect(first[1]!.x - first[0]!.x - first[0]!.width).toBeCloseTo(3.33 * CQI, 10)
    expect(rows[1]![0]!.y - first[0]!.y - first[0]!.height).toBeCloseTo(2.4 * CQI, 10)
    expect(first[0]!.y).toBeCloseTo(DESIGN.height * 0.19, 10)
  })

  it('每排在舞台里居中，整片卡阵留在舞台里', () => {
    for (const row of groupRows(layout.cards)) {
      const last = row[row.length - 1]!
      expect((row[0]!.x + last.x + last.width) / 2).toBeCloseTo(DESIGN.width / 2, 10)
    }
    for (const card of layout.cards) {
      expect(inside(card, DESIGN.width, DESIGN.height)).toBe(true)
    }
  })

  it('返回和标题不叠在一起', () => {
    expect(overlaps(layout.back, layout.title)).toBe(false)
    expect(overlaps(layout.back, layout.subtitle)).toBe(false)
  })

  it('详情浮层：大卡 22cqi 偏左、说明 30cqi 摆右边，两块不重叠', () => {
    const { detail } = layout
    // 放大倍数是「22cqi ÷ 卡面基准宽 150」。
    expect(detail.scale).toBeCloseTo((22 * CQI) / 150, 10)
    const cardWidth = 22 * CQI
    const cardLeft = DESIGN.width * detail.anchorX - cardWidth / 2
    expect(detail.info.width).toBeCloseTo(30 * CQI, 10)
    // 大卡和说明之间 4.8cqi（`.hero__detail-body` 的 gap）。
    expect(detail.info.x - (cardLeft + cardWidth)).toBeCloseTo(4.8 * CQI, 10)
    // 这一行整体在舞台里横向居中。
    expect((cardLeft + detail.info.x + detail.info.width) / 2).toBeCloseTo(DESIGN.width / 2, 10)
  })

  it('详情那一列（卡 + 间距 + 一排钮）在舞台里竖向居中，钮是 20cqi × 6.07cqi', () => {
    const { detail } = layout
    const cardHeight = 22 * CQI * 1.5
    const cardTop = DESIGN.height * detail.anchorY - cardHeight / 2
    expect(detail.buttons.width).toBeCloseTo(20 * CQI, 10)
    expect(detail.buttons.height).toBeCloseTo(6.07 * CQI, 10)
    expect(detail.buttons.gap).toBeCloseTo(3.1 * CQI, 10)
    // 一行和一排钮之间 3.1cqi（`.hero__detail` 的 gap）。
    expect(detail.buttons.y - (cardTop + cardHeight)).toBeCloseTo(3.1 * CQI, 10)
    const bottom = detail.buttons.y + detail.buttons.height
    expect(cardTop).toBeCloseTo(DESIGN.height - bottom, 10)
  })
})

describe('选英雄页手机档', () => {
  const layout = pickHeroLayout(MOBILE.width, MOBILE.height)

  it('3 + 2 + 2 三排——不是把桌面档缩小', () => {
    expect(layout.tier).toBe('mobile')
    expect(groupRows(layout.cards).map((row) => row.length)).toEqual([3, 2, 2])
  })

  it('不缩放：舞台坐标就是视口坐标', () => {
    expect(layout.stage).toEqual({ scale: 1, x: 0, y: 0 })
    expect({ width: layout.width, height: layout.height }).toEqual(MOBILE)
  })

  it('返回和标题不叠在一起——这一档两者在同一行，标题那格要给它让位', () => {
    expect(overlaps(layout.back, layout.title)).toBe(false)
    expect(overlaps(layout.back, layout.subtitle)).toBe(false)
  })

  it('卡是 2:3，整片卡阵留在屏幕里', () => {
    for (const card of layout.cards) {
      expect(card.height / card.width).toBeCloseTo(1152 / 768, 5)
      expect(inside(card, MOBILE.width, MOBILE.height)).toBe(true)
    }
  })

  it('详情浮层：卡居中、说明摞在下面', () => {
    const { detail } = layout
    expect(detail.anchorX).toBe(0.5)
    expect(detail.info.x + detail.info.width / 2).toBeCloseTo(MOBILE.width / 2, 5)
    expect(detail.info.y).toBeGreaterThan(MOBILE.height * detail.anchorY)
  })
})
