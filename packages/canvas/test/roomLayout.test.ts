/**
 * 房间页版式的几何断言（`scenes/room/roomLayout.ts`）。
 *
 * 这份几何有**两个**调用方：场景自己摆方块，端到端用例算点击落点
 *（见 client 的 e2e/roomPage.ts）。所以坏了的表现不是「画面丑」，而是
 * 「联机那两条用例点在空地上、报一句等不到某个状态」——那种失败很难查到这里来。
 *
 * 版式只输出数，所以这些断言不用起浏览器。
 */

import { describe, expect, it } from 'vitest'
import { roomButtons } from '../src/scenes/room/roomContract'
import { pickRoomLayout, type RoomRect } from '../src/scenes/room/roomLayout'

/** 端到端用例钉死的视口（见 client 的 e2e/players.ts）。 */
const VIEWPORT = { width: 1280, height: 900 }

function inside(rect: RoomRect, outer: RoomRect): boolean {
  return (
    rect.x >= outer.x &&
    rect.y >= outer.y &&
    rect.x + rect.width <= outer.x + outer.width &&
    rect.y + rect.height <= outer.y + outer.height
  )
}

describe('房间页版式', () => {
  it('面板在视口正中', () => {
    const { panel } = pickRoomLayout(VIEWPORT.width, VIEWPORT.height, 3)
    expect(panel.x + panel.width / 2).toBeCloseTo(VIEWPORT.width / 2, 5)
    expect(panel.y + panel.height / 2).toBeCloseTo(VIEWPORT.height / 2, 5)
  })

  it('三颗竖排、两颗并排、一颗居中，而且都在面板里', () => {
    const column = pickRoomLayout(VIEWPORT.width, VIEWPORT.height, 3)
    const xs = new Set(column.buttons.map((rect) => rect.x))
    expect(xs.size).toBe(1)
    for (let i = 1; i < column.buttons.length; i += 1) {
      const previous = column.buttons[i - 1]!
      expect(column.buttons[i]!.y).toBeGreaterThanOrEqual(previous.y + previous.height)
    }

    const row = pickRoomLayout(VIEWPORT.width, VIEWPORT.height, 2)
    const ys = new Set(row.buttons.map((rect) => rect.y))
    expect(ys.size).toBe(1)
    expect(row.buttons[1]!.x).toBeGreaterThanOrEqual(row.buttons[0]!.x + row.buttons[0]!.width)

    const single = pickRoomLayout(VIEWPORT.width, VIEWPORT.height, 1)
    const only = single.buttons[0]!
    expect(only.x + only.width / 2).toBeCloseTo(single.panel.x + single.panel.width / 2, 5)

    for (const layout of [column, row, single]) {
      for (const rect of layout.buttons) expect(inside(rect, layout.panel)).toBe(true)
    }
  })

  it('四行字从上往下排，不和按钮压在一起', () => {
    const layout = pickRoomLayout(VIEWPORT.width, VIEWPORT.height, 3)
    const rows = [layout.title, layout.account, layout.code, layout.status]
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1]!
      expect(rows[i]!.y).toBeGreaterThanOrEqual(previous.y + previous.height)
    }
    const lastRow = rows[rows.length - 1]!
    const firstButton = layout.buttons[0]!
    expect(firstButton.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height)
    for (const rect of rows) expect(inside(rect, layout.panel)).toBe(true)
  })

  it('提示挂在面板外面下方', () => {
    const layout = pickRoomLayout(VIEWPORT.width, VIEWPORT.height, 1)
    expect(layout.notice.y).toBeGreaterThanOrEqual(layout.panel.y + layout.panel.height)
  })

  it('窄屏上面板跟着缩，但不缩到放不下按钮', () => {
    const layout = pickRoomLayout(360, 640, 3)
    expect(layout.panel.width).toBeLessThan(560)
    for (const rect of layout.buttons) expect(inside(rect, layout.panel)).toBe(true)
  })

  it('三种局面各摆几颗钮——端到端用例按这个顺序找落点', () => {
    expect(roomButtons('idle', 'hidden')).toEqual(['match', 'create', 'join'])
    expect(roomButtons('busy', 'hidden')).toEqual(['cancel'])
    expect(roomButtons('room', 'hidden')).toEqual(['leave'])
    expect(roomButtons('room', 'idle')).toEqual(['ready', 'leave'])
    expect(roomButtons('room', 'done')).toEqual(['ready', 'leave'])
  })
})
