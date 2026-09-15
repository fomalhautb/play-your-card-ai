/**
 * 「指针压在哪一格上」——两块网格各一条，滚动那一档要先把指针换算到内容坐标里。
 *
 * 单独一个文件是因为这几条判断**两处都要用**：输入层按它抓牌，render 按同一套几何摆格子，
 * 各写一份迟早走岔（一边能抓到、一边画在别处）。纯函数，不碰 Pixi。
 *
 * 滚动那一档的网格是**内容网格**（见 layout/types.ts）：`grid.x / y` 是滚动量为 0 时
 * 第一行的左上角，屏幕上看到的第 n 格因此在 `cellRect(grid, n).y - offset` 处。
 * 所以判定分两步：先看指针在不在窗口里（窗口之外画的东西被遮罩裁掉了，看不见就不该抓得到），
 * 再把指针加上滚动量换回内容坐标，剩下的就是普通的最近格判定。
 */

import { type GridSpec, insideGrid, type NearestCell, nearestCell } from '../../layout/gridMath'
import type { Rect } from './layout/types'

export interface Point {
  x: number
  y: number
}

/** 指针在这块网格的可视范围里吗。滚动那一档看窗口，不滚动那一档看网格自己的外接矩形。 */
export function insideArea(grid: GridSpec, view: Rect | null, point: Point): boolean {
  if (view === null) return insideGrid(grid, point)
  return (
    point.x >= view.x &&
    point.x <= view.x + view.width &&
    point.y >= view.y &&
    point.y <= view.y + view.height
  )
}

/**
 * 指针离哪一格最近（格子的序号从内容第一格起算）。
 *
 * @param count 只在前 count 格里找。卡池按筛完的张数收窄，牌组按此刻画着的张数收窄。
 * @param offset 这块网格滚了多远。不滚动的那一档传 0。
 */
export function cellAt(
  grid: GridSpec,
  point: Point,
  count: number,
  offset: number,
): NearestCell | null {
  return nearestCell(grid, { x: point.x, y: point.y + offset }, count)
}
