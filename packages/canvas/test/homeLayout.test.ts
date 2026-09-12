/**
 * 首页两档版式的几何断言（`scenes/home/homeLayout.ts`）。
 *
 * 守的是「两档是并列的两套摆法，不是缩放」这条（需求第 3 条）：桌面档菜单横排、
 * 手机档竖排。顺带守几条一眼看不出、坏了却很难查的：东西不许跑出视口、菜单项不许互相压住。
 *
 * 版式只输出数，所以这些断言不用起浏览器（和对局那两档的测试同一个理由）。
 */

import { describe, expect, it } from 'vitest'
import { type HomeRect, pickHomeLayout } from '../src/scenes/home/homeLayout'

/** 桌面档和手机档各取一个真实视口。手机那档是 iPhone 竖屏。 */
const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

/** 开发构建下的六项菜单。 */
const LABELS = ['牌组', '英雄', '联机', '测试对局', '关于', '设置']

function inside(rect: HomeRect, width: number, height: number): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height
  )
}

describe('首页版式', () => {
  it('桌面档：那幅画按 contain 塞进视口并居中', () => {
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    expect(layout.tier).toBe('desktop')
    // 1280 / 1672 比 900 / 941 小，所以是宽度顶到边、上下留白。
    expect(layout.stage.width).toBeCloseTo(1280, 5)
    expect(layout.stage.x).toBeCloseTo(0, 5)
    expect(layout.stage.y).toBeGreaterThan(0)
    expect(layout.stage.height / layout.stage.width).toBeCloseTo(941 / 1672, 5)
  })

  it('桌面档：菜单横着排成一行，项与项不重叠，还有分隔星', () => {
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    expect(layout.menu).toHaveLength(LABELS.length)
    const ys = new Set(layout.menu.map((item) => item.y))
    expect(ys.size).toBe(1)
    for (let i = 1; i < layout.menu.length; i += 1) {
      const previous = layout.menu[i - 1]!
      expect(layout.menu[i]!.x).toBeGreaterThanOrEqual(previous.x + previous.width)
    }
    expect(layout.menuDotSize).toBeGreaterThan(0)
  })

  it('手机档：菜单竖着摞，不摆分隔星', () => {
    const layout = pickHomeLayout(MOBILE.width, MOBILE.height, LABELS)
    expect(layout.tier).toBe('mobile')
    const xs = new Set(layout.menu.map((item) => item.x))
    // 每项宽度不同，所以居中之后 x 各不相同；要断言的是它们**纵向**一项接一项。
    expect(xs.size).toBeGreaterThan(1)
    for (let i = 1; i < layout.menu.length; i += 1) {
      const previous = layout.menu[i - 1]!
      expect(layout.menu[i]!.y).toBeGreaterThanOrEqual(previous.y + previous.height)
    }
    expect(layout.menuDotSize).toBe(0)
  })

  it('手机档：画缩在屏幕上半部，主入口和整排菜单都在它下面、也都在屏幕里', () => {
    const layout = pickHomeLayout(MOBILE.width, MOBILE.height, LABELS)
    const stageBottom = layout.stage.y + layout.stage.height
    expect(stageBottom).toBeLessThan(MOBILE.height / 2)
    expect(layout.start.y).toBeGreaterThan(stageBottom)
    expect(inside(layout.start, MOBILE.width, MOBILE.height)).toBe(true)
    const last = layout.menu[layout.menu.length - 1]!
    expect(inside(last, MOBILE.width, MOBILE.height)).toBe(true)
  })

  it('两档摆的都是四张展示卡，位置跟着画走', () => {
    for (const size of [DESKTOP, MOBILE]) {
      const layout = pickHomeLayout(size.width, size.height, LABELS)
      expect(layout.cards).toHaveLength(4)
      for (const card of layout.cards) {
        expect(card.x).toBeGreaterThan(layout.stage.x)
        expect(card.x).toBeLessThan(layout.stage.x + layout.stage.width)
        expect(card.scale).toBeGreaterThan(0)
      }
    }
    // 两端的卡沉下去、中间两张抬起来（弧口朝上），倾角左右对称。
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, LABELS)
    expect(layout.cards[0]!.rotation).toBe(-layout.cards[3]!.rotation)
    expect(layout.cards[0]!.y).toBeGreaterThan(layout.cards[1]!.y)
  })

  it('菜单少一项（生产构建没有「测试对局」）时整排照样居中', () => {
    const short = LABELS.filter((label) => label !== '测试对局')
    const layout = pickHomeLayout(DESKTOP.width, DESKTOP.height, short)
    expect(layout.menu).toHaveLength(short.length)
    const left = layout.menu[0]!.x
    const right = layout.menu[layout.menu.length - 1]!
    const center = (left + right.x + right.width) / 2
    expect(center).toBeCloseTo(layout.stage.x + layout.stage.width / 2, 5)
  })

  it('指针粗就走手机档，和视口多大无关（大屏平板也是手指在点）', () => {
    expect(pickHomeLayout(1280, 900, LABELS, true).tier).toBe('mobile')
  })
})
