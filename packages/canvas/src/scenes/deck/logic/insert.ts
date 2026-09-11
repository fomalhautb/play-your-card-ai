/**
 * 拖一张牌进牌组栏时的落点，以及拖拽途中让出来的那个空位（`previewGap`）。
 *
 * 落点有两套口径，旧版就是两套（`DeckScreen.tsx` 的 `insertIndexAt` / `pageInsertIndex`）：
 * - **拖拽**有指针位置可用，落点必须跟手 → 这个文件的 `insertIndexAt`；
 * - **点「＋」**没有指针语义，接在末尾会落到看不见的地方 → `pagination.ts` 的 `pageInsertIndex`。
 *
 * 两条路最后都汇进同一个「插在第几个之前」，所以加牌只有一个入口。
 */

import { type GridSpec, nearestCell } from '../../../layout/gridMath'

/**
 * 拖拽途中让出来的那一格：`null` 表示现在没有落点（指针不在牌组栏里）。
 * 数值是**格子的序号**，`0` 就是让在最前面。
 */
export type PreviewGap = number | null

/**
 * 让位之后，20 个格子里各坐着牌组数组的第几张（`null` 就是让出来的那个空位）。
 *
 * 空位是**多插一个**，不是占掉一张牌：所以尾巴上会挤掉一个空格子，而牌组满 20 张时
 * 卡池那张根本拖不动（见 legality.ts），不会挤掉真牌。
 */
export function slotEntries<T>(deck: readonly T[], gap: PreviewGap): (T | null)[] {
  if (gap === null) return [...deck]
  const list: (T | null)[] = [...deck]
  list.splice(Math.min(Math.max(0, gap), deck.length), 0, null)
  return list
}

export interface InsertAtInput {
  /** 牌组那 20 个卡位的网格。 */
  grid: GridSpec
  /** 牌组现在有几张。 */
  deckLength: number
  /** 此刻让在哪一格（还没让位就是 null）。 */
  gap: PreviewGap
  /** 指针位置，和 `grid` 用同一套坐标。 */
  point: { x: number; y: number }
}

/**
 * 指针停在这儿，松手要插进第几个之前。
 *
 * 算法照搬旧版的 `insertIndexAt`：找离指针最近的**格子**（空格子也算），
 * 落在它左半边就插它前面、右半边就插它后面。
 *
 * 难的是中间那一步换算：让出空位之后，屏幕上的第 N 格 ≠ 牌组数组的第 N 项。
 * 不换算的话会来回跳——指针停在空位右半边 → 算出后一格 → 空位挪过去 →
 * 指针又落在新空位的左半边 → 空位挪回来。所以：
 * 1. 指针就停在空位上时**维持**现在这个落点（那正是玩家瞄准的地方）；
 * 2. 最近的格子排在空位之后时，序号要减掉空位自己占的那一格。
 */
export function insertIndexAt({ grid, deckLength, gap, point }: InsertAtInput): number {
  const nearest = nearestCell(grid, point)
  if (nearest === null) return deckLength
  if (gap !== null && nearest.index === gap) return gap
  const real = gap !== null && nearest.index > gap ? nearest.index - 1 : nearest.index
  // 最近的是尾巴上那些空格子：一律接在最后，而不是插到某个不存在的位置前面。
  if (real >= deckLength) return deckLength
  return nearest.after ? real + 1 : real
}
