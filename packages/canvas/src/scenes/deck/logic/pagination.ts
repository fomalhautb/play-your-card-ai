/**
 * 卡池分页。**只有手机档用它**。
 *
 * 桌面档已经回到黑客松那一版的纵向滚动（见 layout/desktopLayout.ts 和 scroll.ts）：
 * 翻页是搬到画布上时为了省掉一层遮罩临时换的做法，代价是「往下扫一眼」变成了
 *「记住自己翻到第几页」。手机档留着翻页：那一档一页只有 6 张、卡池本来就得一屏一屏看，
 * 而且滑动那一维已经让给了「从卡池拖一张进抽屉」（见 dragRules 的 scrollGuard）。
 *
 * 一页几张由版式给（手机 3 列 × 2 行），不是这里定的。
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
 * 语义和滚动那一档（`scroll.ts` 的 `scrollInsertIndex`）是同一件事，只是那边量滚动量、
 * 这边做一次乘法：接在末尾的话，牌组超过一屏时新牌会落到眼前看不见的地方，
 * 玩家会以为这一下没生效。
 *
 * 牌组已经排到这一页之后（比如停在第 2 页而牌组只有 3 张）时接在末尾——
 * 那一页上一张牌都没有，「第一格」指不到任何东西。
 */
export function pageInsertIndex(page: number, perPage: number, deckLength: number): number {
  return Math.min(Math.max(0, page * perPage), deckLength)
}
