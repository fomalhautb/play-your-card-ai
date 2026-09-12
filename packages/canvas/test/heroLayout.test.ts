/**
 * 选英雄页两档版式的几何断言（`scenes/hero/heroLayout.ts`）。
 *
 * 守的还是「两档是并列的两套摆法，不是缩放」（需求第 3 条）：
 * 桌面档 4 + 3 两排，手机档 3 + 2 + 2 三排，卡的大小也各算各的。
 *
 * 版式只输出数，所以这些断言不用起浏览器（和首页、对局那几档的测试同一个理由）。
 */

import { describe, expect, it } from 'vitest'
import { type HeroRect, pickHeroLayout } from '../src/scenes/hero/heroLayout'

/** 桌面档和手机档各取一个真实视口。手机那档是 iPhone 竖屏。 */
const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

function inside(rect: HeroRect, width: number, height: number): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height
  )
}

describe('选英雄页版式', () => {
  it('桌面档 4 + 3 两排，每排各自居中', () => {
    const layout = pickHeroLayout(DESKTOP.width, DESKTOP.height)
    expect(layout.tier).toBe('desktop')
    expect(layout.cards).toHaveLength(7)
    const rows = groupRows(layout.cards)
    expect(rows.map((row) => row.length)).toEqual([4, 3])
    for (const row of rows) {
      const left = row[0]!.x
      const last = row[row.length - 1]!
      expect((left + last.x + last.width) / 2).toBeCloseTo(DESKTOP.width / 2, 5)
    }
  })

  it('手机档 3 + 2 + 2 三排——不是把桌面档缩小', () => {
    const layout = pickHeroLayout(MOBILE.width, MOBILE.height)
    expect(layout.tier).toBe('mobile')
    expect(groupRows(layout.cards).map((row) => row.length)).toEqual([3, 2, 2])
  })

  it('两档的卡都是 2:3，而且整片卡阵留在屏幕里', () => {
    for (const size of [DESKTOP, MOBILE]) {
      const layout = pickHeroLayout(size.width, size.height)
      for (const card of layout.cards) {
        expect(card.height / card.width).toBeCloseTo(1152 / 768, 5)
        expect(inside(card, size.width, size.height)).toBe(true)
      }
    }
  })

  it('详情浮层：桌面档卡偏左、说明摆右边；手机档卡居中、说明摞在下面', () => {
    const desktop = pickHeroLayout(DESKTOP.width, DESKTOP.height).detail
    expect(desktop.anchorX).toBeLessThan(0.5)
    expect(desktop.info.x).toBeGreaterThan(DESKTOP.width * desktop.anchorX)

    const mobile = pickHeroLayout(MOBILE.width, MOBILE.height).detail
    expect(mobile.anchorX).toBe(0.5)
    expect(mobile.info.x + mobile.info.width / 2).toBeCloseTo(MOBILE.width / 2, 5)
  })
})

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
