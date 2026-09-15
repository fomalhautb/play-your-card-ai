/**
 * 「玩家点了某个控件」之后改什么：换筛选、翻一屏、加一张、删一张、开关抽屉。
 *
 * 全是**只认上下文**的自由函数，场景只负责把按钮接到它们身上（见 DeckScene 的 buildParts）。
 * 拆出来是因为这几条都是「改状态 + 重排画面」的一行活，摊在场景类里会把那个文件
 * 变成一张按钮接线表（400 行那条上限也容不下）。
 */

import type { DeckContext } from './context'
import { addFromPool } from './input'
import { pageInsertIndex } from './logic/pagination'
import { currentPage, poolPageCount, renderDeckScene } from './render'
import { scrollInsertIndex } from './scroll'
import { currentCards, type DeckState, removeAt, setDrawerOpen, setPage } from './state'

/** 改一次状态并重排画面。这个文件里每一条最后都走它。 */
function change(ctx: DeckContext, next: (state: DeckState) => DeckState): void {
  ctx.state = next(ctx.state)
  renderDeckScene(ctx)
}

/** 换筛选 / 换牌组：卡池滚回顶上。停在原来那个滚动量上等于让人对着一屏陌生的牌发懵。 */
export function changeFilter(ctx: DeckContext, next: (state: DeckState) => DeckState): void {
  ctx.poolScroll.reset()
  change(ctx, next)
}

/**
 * 翻一屏卡池。
 *
 * 两档的「一屏」不是一回事：手机档翻页（页码加一），桌面档滚动（往下滚一整个窗口高）。
 * 合成一个入口是为了让契约和 bench 剧本不用分档——它们要的是「整屏换掉」这件事
 *（见 bench 的 scenarios/deckScroll.ts），不是「页码变了」。
 */
export function turnScreen(ctx: DeckContext, delta: number): void {
  const scroll = ctx.layout.poolScroll
  if (scroll !== null) {
    if (ctx.poolScroll.scrollBy(delta * scroll.view.height)) renderDeckScene(ctx)
    return
  }
  const pages = poolPageCount(ctx)
  const next = Math.min(Math.max(0, currentPage(ctx) + delta), pages - 1)
  change(ctx, (state) => setPage(state, next))
}

/**
 * 点「＋」和放大层那颗钮的落点：**视野里第一格**。
 *
 * 两档口径不同（翻页那一档按页算、滚动那一档按滚动量算），但说的是同一件事：
 * 接在末尾的话，牌组超过一屏时新牌会落到眼前看不见的地方，玩家会以为这一下没生效。
 */
export function insertIndex(ctx: DeckContext): number {
  const deckLength = currentCards(ctx.state).length
  if (ctx.layout.slotScroll === null) {
    return pageInsertIndex(currentPage(ctx), ctx.parts.poolCells.length, deckLength)
  }
  return scrollInsertIndex(ctx.slotScroll.offset, ctx.layout.slots, deckLength)
}

/** 点卡池第 slot 格的「＋」。格子的序号要先换成卡池的序号（见 PoolCell.poolIndex）。 */
export function addAtCell(ctx: DeckContext, slot: number): void {
  const poolIndex = ctx.parts.poolCells[slot]?.poolIndex ?? -1
  if (poolIndex < 0) return
  addFromPool(ctx, poolIndex, insertIndex(ctx))
}

/** 点第 index 格的「－」。真的少了一张才往外报（越界时 `removeAt` 原样返回）。 */
export function removeSlot(ctx: DeckContext, index: number): void {
  const before = currentCards(ctx.state).length
  change(ctx, (state) => removeAt(state, index))
  if (currentCards(ctx.state).length !== before) ctx.emitChange()
}

/** 手机档：开关抽屉。桌面档牌组栏一直摊着，这一下什么都不做。 */
export function toggleDrawer(ctx: DeckContext): void {
  if (ctx.layout.drawer === null) return
  change(ctx, (state) => setDrawerOpen(state, !state.drawerOpen))
}
