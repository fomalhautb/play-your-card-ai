/**
 * 首页版式的几何断言（`scenes/home/homeLayout.ts`）。
 *
 * 正式版简化第 4 步之后两档共用同一套摆法（上面一排展示卡、下面一列素方块），
 * `pickTier` 只剩「展示卡放多大」这一件事，所以这里守的也换了一批：
 * 整列不许互相压住、不许跑出视口，四张卡还是一道弧口朝上的扇面，
 * 手机档的卡比桌面档小。
 *
 * 版式只输出数，所以这些断言不用起浏览器（和对局那两档的测试同一个理由）。
 */

import { describe, expect, it } from 'vitest'
import { type HomeRect, pickHomeLayout } from '../src/scenes/home/homeLayout'

/** 桌面档和手机档各取一个真实视口。手机那档是 iPhone 竖屏。 */
const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

/** 开发构建下的七项菜单（生产构建没有「测试对局」）。 */
const LABELS = ['牌组', '英雄', '联机', '测试对局', '账号', '关于', '设置']

function inside(rect: HomeRect, width: number, height: number): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height
  )
}

/** 「开始游戏」加菜单那几项，从上到下的整列。 */
function column(layout: ReturnType<typeof pickHomeLayout>): HomeRect[] {
  return [layout.start, ...layout.menu]
}

describe('首页版式', () => {
  for (const [name, size] of [
    ['桌面档', DESKTOP],
    ['手机档', MOBILE],
  ] as const) {
    it(`${name}：整列一项接一项，谁也不压住谁，而且都在屏幕里`, () => {
      const layout = pickHomeLayout(size.width, size.height, LABELS)
      expect(layout.menu).toHaveLength(LABELS.length)
      const rows = column(layout)
      for (let i = 1; i < rows.length; i += 1) {
        const previous = rows[i - 1]!
        expect(rows[i]!.y).toBeGreaterThanOrEqual(previous.y + previous.height)
      }
      for (const rect of rows) {
        expect(inside(rect, size.width, size.height)).toBe(true)
        // 定宽，所以整列左右对齐——这正是素方块和从前「按字数量宽」的区别。
        expect(rect.width).toBe(layout.start.width)
        expect(rect.x).toBeCloseTo((size.width - rect.width) / 2, 5)
      }
    })
  }

  it('两档都摆四张展示卡，是一道弧口朝上的扇面', () => {
    for (const size of [DESKTOP, MOBILE]) {
      const layout = pickHomeLayout(size.width, size.height, LABELS)
      expect(layout.cards).toHaveLength(4)
      for (const card of layout.cards) {
        expect(card.x).toBeGreaterThan(0)
        expect(card.x).toBeLessThan(size.width)
        expect(card.scale).toBeGreaterThan(0)
      }
    }
    // 两端的卡沉下去、中间两张抬起来（弧口朝上），倾角左右对称。
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    expect(layout.cards[0]!.rotation).toBe(-layout.cards[3]!.rotation)
    expect(layout.cards[0]!.y).toBeGreaterThan(layout.cards[1]!.y)
  })

  it('展示卡摆在整列上方，不和「开始游戏」压在一起', () => {
    for (const size of [DESKTOP, MOBILE]) {
      const layout = pickHomeLayout(size.width, size.height, LABELS)
      for (const card of layout.cards) {
        expect(card.y).toBeLessThanOrEqual(layout.start.y)
      }
    }
  })

  it('菜单少一项（生产构建没有「测试对局」）时整列照样摆得下', () => {
    const short = LABELS.filter((label) => label !== '测试对局')
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, short)
    expect(layout.menu).toHaveLength(short.length)
    const last = layout.menu[layout.menu.length - 1]!
    expect(inside(last, DESKTOP.width, DESKTOP.height)).toBe(true)
  })

  it('指针粗就走手机档，和视口多大无关（大屏平板也是手指在点）', () => {
    expect(pickHomeLayout(1280, 900, LABELS, true).tier).toBe('mobile')
  })

  it('手机档的展示卡比桌面档小——这是 tier 现在唯一还管的事', () => {
    const desktop = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    const mobile = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS, true)
    expect(mobile.cards[0]!.scale).toBeLessThan(desktop.cards[0]!.scale)
  })
})
