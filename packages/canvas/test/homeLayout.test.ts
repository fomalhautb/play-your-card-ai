/**
 * 首页版式的几何断言（`scenes/home/homeLayout.ts`）。
 *
 * 这一页现在只剩一列素方块（上面那一排展示卡也删了），所以这里守的就三件事：
 * 整列一项接一项不互相压住、都在屏幕里、并且给右上角那颗常驻静音钮让出了一条。
 *
 * 版式只输出数，所以这些断言不用起浏览器（和对局那两档的测试同一个理由）。
 */

import { describe, expect, it } from 'vitest'
import { type HomeRect, pickHomeLayout } from '../src/scenes/home/homeLayout'

/** 宽窄各取一个真实视口。窄的那个是 iPhone 竖屏。 */
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
    ['宽视口', DESKTOP],
    ['窄视口', MOBILE],
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

  it('整列在视口里上下居中', () => {
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    const rows = column(layout)
    const top = rows[0]!.y
    const bottom = rows[rows.length - 1]!.y + rows[rows.length - 1]!.height
    // 上面多留的那一点是给静音钮的下限（TOP_RESERVED），所以只要求大致对称。
    expect(Math.abs(top - (DESKTOP.height - bottom))).toBeLessThanOrEqual(52)
  })

  it('整列不顶到视口上缘，给右上角那颗常驻静音钮让出一条', () => {
    /*
     * 矮屏上整列会一路铺满，而那颗 DOM 静音钮钉在视口右上角（client 的 app/MuteButton.tsx），
     * 画布这边量不到它，所以版式里有一条上边的下限。
     */
    const layout = pickHomeLayout(375, 420, LABELS)
    expect(layout.start.y).toBeGreaterThanOrEqual(52)
  })

  it('菜单少一项（生产构建没有「测试对局」）时整列照样摆得下', () => {
    const short = LABELS.filter((label) => label !== '测试对局')
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, short)
    expect(layout.menu).toHaveLength(short.length)
    const last = layout.menu[layout.menu.length - 1]!
    expect(inside(last, DESKTOP.width, DESKTOP.height)).toBe(true)
  })

  it('窄视口那一列比宽视口窄（宽度按视口宽算，夹在上下限之间）', () => {
    const desktop = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    const mobile = pickHomeLayout(MOBILE.width, MOBILE.height, LABELS)
    expect(mobile.start.width).toBeLessThan(desktop.start.width)
  })
})
