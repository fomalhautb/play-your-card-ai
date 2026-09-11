/**
 * 一块等距网格的几何：第 n 格在哪儿、离指针最近的是哪一格。
 *
 * 和旁边的 `fanMath.ts`（手牌扇形）、`handLayout.ts`（hover 让位）是同一类东西——
 * 布局数学，纯数字，不碰 Pixi。放这儿而不是放进牌组场景里，是因为组件也要用它
 *（`DeckSlots` 按它画 20 个格子），而组件不该反过来依赖某个场景。
 *
 * 现在的用处：构筑页的卡池网格和牌组那 20 个卡位，两边只是行列数和格子大小不同。
 * 落点判定是拖拽手感的全部，也是最容易改坏的地方，所以它必须能在 vitest 里
 * 直接喂坐标断言（见 canvas/test/deckLogic.test.ts）。
 */

/** 一块网格。原点是**左上角**，坐标系由调用方定（场景里用的是视口坐标）。 */
export interface GridSpec {
  x: number
  y: number
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  /** 相邻两格之间留多宽 / 多高。 */
  gapX: number
  gapY: number
}

export interface CellRect {
  x: number
  y: number
  width: number
  height: number
}

/** 这块网格一共几格。 */
export function cellCount(grid: GridSpec): number {
  return grid.columns * grid.rows
}

/** 整块网格占多宽多高。摆版式时按它算底板的尺寸。 */
export function gridSize(grid: GridSpec): { width: number; height: number } {
  return {
    width: grid.columns * grid.cellWidth + (grid.columns - 1) * grid.gapX,
    height: grid.rows * grid.cellHeight + (grid.rows - 1) * grid.gapY,
  }
}

/** 第 index 格的矩形。index 超出行列数也照算（沿着最后一行往右排），调用方自己保证不越界。 */
export function cellRect(grid: GridSpec, index: number): CellRect {
  const column = index % grid.columns
  const row = Math.floor(index / grid.columns)
  return {
    x: grid.x + column * (grid.cellWidth + grid.gapX),
    y: grid.y + row * (grid.cellHeight + grid.gapY),
    width: grid.cellWidth,
    height: grid.cellHeight,
  }
}

/** 第 index 格的中心。摆卡按它——卡的原点在底边中点，所以调用方还要往下让半张。 */
export function cellCenter(grid: GridSpec, index: number): { x: number; y: number } {
  const rect = cellRect(grid, index)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** 离指针最近的那一格。 */
export interface NearestCell {
  index: number
  /**
   * 指针落在这一格的**右半边**。
   *
   * 「插它前面还是后面」只看横向：网格是按行从左到右排的，纵向差半格并不改变先后次序，
   * 算进去只会让指针在行与行之间上下抖一点就换落点。旧版 `insertIndexAt` 也是这么分的。
   */
  after: boolean
}

/**
 * 指针离哪一格最近。空网格返回 null。
 *
 * 比的是**到格心的欧氏距离**，不是「指针落在哪一格里」：格与格之间有空隙，
 * 落在空隙上时「在哪一格里」没有答案，而拖拽必须一直有个落点跟着手。
 *
 * @param count 只在前 count 格里找。默认整块网格；卡池那边最后一页不满，要按实际张数收窄。
 */
export function nearestCell(
  grid: GridSpec,
  point: { x: number; y: number },
  count = cellCount(grid),
): NearestCell | null {
  let best: NearestCell | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index += 1) {
    const center = cellCenter(grid, index)
    const distance = Math.hypot(point.x - center.x, point.y - center.y)
    if (distance >= bestDistance) continue
    bestDistance = distance
    best = { index, after: point.x > center.x }
  }
  return best
}

/** 指针在不在这块网格的外接矩形里。判「拖进牌组栏了没有」用它。 */
export function insideGrid(grid: GridSpec, point: { x: number; y: number }): boolean {
  const size = gridSize(grid)
  return (
    point.x >= grid.x &&
    point.x <= grid.x + size.width &&
    point.y >= grid.y &&
    point.y <= grid.y + size.height
  )
}
