/**
 * 卡池分页。
 *
 * **和旧版不一样**：旧版卡池是一块竖向滚动的四列网格（`.deck-grid` 的 `overflow-y: auto`），
 * 没有页这个概念。搬到画布上之后改成分页，两个原因：
 * 1. 画布上没有现成的滚动容器——自己做就要一层遮罩加上离屏剔除，而遮罩是全屏半透明层
 *    之外另一笔离屏开销（纪律 3.1、3.2），为一块卡池不值当；
 * 2. 分页之后「一页」是个明确的东西，点「＋」的落点（旧版的 `pageInsertIndex`
 *    取的是"当前视野这一页的第一格"）不用再去量滚动位置，直接就是这一页的头一格。
 *
 * 一页几张由版式给（桌面 4 列 × 2 行，手机 3 列 × 2 行），不是这里定的。
 */

/** 一共几页。一张卡都没有时仍然是 1 页——界面上总得有一页空的可看。 */
export function pageCount(total: number, perPage: number): number {
  if (perPage <= 0) return 1
  return Math.max(1, Math.ceil(total / perPage))
}

/**
 * 把页码夹回有效范围。
 *
 * 筛选一变、卡池一少，当前页可能就落在最后一页之外了。夹到最后一页而不是回到第一页：
 * 玩家刚才在翻后面几页，把他弹回开头等于让他重新翻一遍。
 */
export function clampPage(page: number, total: number, perPage: number): number {
  return Math.min(Math.max(0, Math.trunc(page)), pageCount(total, perPage) - 1)
}

/** 第 page 页上是哪几张（页码从 0 起）。越界的页给空数组，调用方先 `clampPage`。 */
export function pageSlice<T>(items: readonly T[], page: number, perPage: number): T[] {
  if (perPage <= 0) return []
  const start = page * perPage
  return items.slice(start, start + perPage)
}

/**
 * 点「＋」时这张牌插进牌组的第几个之前：**当前这一页的第一格**。
 *
 * 旧版 `pageInsertIndex` 量的是滚动位置（`Math.round(scrollTop / clientHeight) * clientHeight`
 * 再找第一格落在这条线下面的槽），分页之后这一步就是一次乘法。
 * 语义完全一样：接在末尾的话，牌组超过一页时新牌会落到眼前看不见的地方，
 * 玩家会以为这一下没生效。
 *
 * 牌组已经排到这一页之后（比如停在第 2 页而牌组只有 3 张）时接在末尾——
 * 那一页上一张牌都没有，「第一格」指不到任何东西。
 */
export function pageInsertIndex(page: number, perPage: number, deckLength: number): number {
  return Math.min(Math.max(0, page * perPage), deckLength)
}
