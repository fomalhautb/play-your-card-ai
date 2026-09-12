/**
 * 状态 → 画面：把 `DeckState` 里的那几项摆到零件上。
 *
 * 这个文件是**唯一**改零件外观的地方，输入只有上下文，没有指针也没有时钟。
 *
 * 每一轮都是「先 `beginBorrow`，按这一轮的样子一张张取，最后 `endBorrow`」。
 * 看着像「全部重来」，其实一个对象都不新建，连场景树都基本不动——上一轮借出去的卡
 * 在这一轮再被要到时会**原样返回**（连带它还挂在原来那一格上），只有真的没人再要的
 * 才在 `endBorrow` 那一步摘下来（见 cards.ts 和 DeckScene 的 `borrowed`）。
 *
 * 这样写是因为这一页的卡随时在换位置（滚动、加牌、删牌、让位），
 * 逐张比对「谁挪到哪儿了」的代码比它长十倍，还容易漏。
 *
 * ## 滚动那一档的离屏剔除
 *
 * 卡池的格子数是**窗口里同时摆得下几格**，不是卡池有几张：滚动时格子原地回收，
 * 只换里面那张卡和它的落点（`cell.poolIndex` 记着它这一轮代表的是第几张）。
 * 所以卡池再长，场景树上也永远只有那十来个格子、十来张卡。
 */

import type { CardSprite } from '../../components/CardSprite'
import { cellRect } from '../../layout/gridMath'
import type { DeckContext } from './context'
import { slotEntries } from './logic/insert'
import { copiesOf, isCompleteDeck, shortfallOf } from './logic/legality'
import { clampPage, pageCount, pageSlice } from './logic/pagination'
import { filterPool, kindCounts, type PoolCard } from './logic/types'
import { contentHeight, firstVisibleRow, rowStep, thumbSpan } from './scroll'
import { currentCards, currentDeck } from './state'

/** 种类页签上印什么。张数按整个卡池算，不跟着筛选变（同旧版）。 */
const KIND_LABELS = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI 牌' },
  { id: 'skill', label: '技能牌' },
] as const

/** 「全部阵营」那一项的 id。它不是任何一家，所以给一个不会和真阵营撞的值。 */
export const ALL_FACTIONS = '__all__'

/** 卡池底边那条提示的两句话。 */
const POOL_HINT = '点卡面放大 · 点加号或拖进牌组栏加入'
const POOL_HINT_FULL = '牌组已满 · 先移除才能再加'
/** 牌组栏底边那条。**牌组内不换位置**，所以这句话不提「拖动换位」。 */
const SIDE_HINT = '点减号移除 · 拖回卡池也行'

/** 筛完之后的整份卡池（还没切页）。 */
export function filteredPool(ctx: DeckContext): PoolCard[] {
  return filterPool(ctx.pool, ctx.state.kind, ctx.state.faction)
}

/** 筛完一共几页。只有翻页那一档（手机）用得着。 */
export function poolPageCount(ctx: DeckContext): number {
  return pageCount(filteredPool(ctx).length, ctx.parts.poolCells.length)
}

/** 夹回有效范围之后的当前页。 */
export function currentPage(ctx: DeckContext): number {
  return clampPage(ctx.state.page, filteredPool(ctx).length, ctx.parts.poolCells.length)
}

/**
 * 卡池里现在**画得出来**的那几张，以及各自在筛完那一份里的序号。
 *
 * 两档口径不同：翻页那一档是当前这一页，滚动那一档是窗口里那几行。
 * 序号一律按**筛完的整份**算——拖拽、「＋」、放大都按它回问是哪张牌，
 * 两档共用一个口径，下游不用判档位。
 */
export function visiblePool(ctx: DeckContext): { entry: PoolCard; index: number }[] {
  const all = filteredPool(ctx)
  const count = ctx.parts.poolCells.length
  const base =
    ctx.layout.poolScroll === null
      ? currentPage(ctx) * count
      : firstVisibleRow(ctx.poolScroll.offset, rowStep(ctx.layout.poolGrid)) *
        ctx.layout.poolGrid.columns
  const slice =
    ctx.layout.poolScroll === null
      ? pageSlice(all, currentPage(ctx), count)
      : all.slice(base, base + count)
  return slice.map((entry, offset) => ({ entry, index: base + offset }))
}

/**
 * 牌组栏此刻**画出来**的那几张。
 *
 * 正从牌组里往外拖的那一张不算在内：它已经跟着指针走了，原来那一格该空着
 *（旧版靠把节点切成 fixed 达到同样效果）。真的移除要等松手落在牌组栏外面。
 */
export function shownDeck(ctx: DeckContext): string[] {
  const deck = [...currentCards(ctx.state)]
  const drag = ctx.dragging
  if (drag !== null && drag.from === 'deck') deck.splice(drag.index, 1)
  return deck
}

/** 整页重摆一遍。加牌、删牌、滚动、换筛选、换牌组都走它。 */
export function renderDeckScene(ctx: DeckContext): void {
  ctx.beginBorrow()
  renderTabs(ctx)
  renderPool(ctx)
  renderSide(ctx)
  renderDrawer(ctx)
  ctx.endBorrow()
  ctx.wake()
}

/**
 * 抽屉开着还是收着。**只写一个 y**，一块底板都不重画（见 layout/mobileLayout.ts）。
 *
 * 不做开合动画：这一页的截图回归停的是「最终画面」，加一段补间只会让基线要么拍到中途、
 * 要么逼着每条条目多推几百毫秒。真要加，那是把 `layers.side.y` 交给 `Animator` 的事。
 */
function renderDrawer(ctx: DeckContext): void {
  const open = ctx.layout.drawer === null || ctx.state.drawerOpen
  ctx.parts.layers.side.y = open ? 0 : ctx.layout.drawerOffset
  /*
   * 抽屉展开之后**把卡池整层藏起来**。
   *
   * 它本来就被这块面板盖住了，画了也看不见；而不藏的话那一屏的每个像素要画两遍
   *（卡池底板加六张大卡，再加抽屉底板加二十张小卡）——纪律 3.2 那条「过度绘制」当场顶穿。
   * 桌面档没有抽屉，两块并排摆，这一行对它是恒真。
   */
  const covered = ctx.layout.drawer !== null && open
  ctx.parts.layers.pool.visible = !covered
  ctx.parts.layers.poolCards.visible = !covered
}

/** 三排页签：种类、阵营、牌组。内容没变的那几排不会被重建（见 BoxTabs.setItems）。 */
function renderTabs(ctx: DeckContext): void {
  const counts = kindCounts(ctx.pool)
  const kinds = KIND_LABELS.map((one) => ({ id: one.id, label: `${one.label} ${counts[one.id]}` }))
  ctx.parts.kindTabs.setItems(kinds, ctx.state.kind)

  /*
   * 阵营药丸**只在「AI 牌」那一页有意义**（技能牌没有阵营）。
   * 另两页仍然摆一颗常亮的「全部卡牌」占位：整排抽掉的话，切页签时头部条会塌一下，
   * 底下的网格跟着上下跳（旧版也是这么占位的）。
   */
  const factions =
    ctx.state.kind === 'ai'
      ? [{ id: ALL_FACTIONS, label: '全部阵营' }, ...ctx.factions]
      : [{ id: ALL_FACTIONS, label: '全部卡牌' }]
  ctx.parts.factionTabs.setItems(factions, ctx.state.faction ?? ALL_FACTIONS)
  ctx.parts.factionTabs.setDisabled(ctx.state.kind !== 'ai')

  ctx.parts.deckTabs.setItems(
    ctx.state.decks.map((deck) => ({ id: deck.id, label: deck.name })),
    ctx.state.currentId,
  )
  ctx.parts.newDeck.setDisabled(ctx.state.decks.length >= ctx.rules.maxDecks)
  // 一套都不剩的时候没什么可改名可删的。存档保证至少留一套，这里只是兜底。
  const hasDeck = currentDeck(ctx.state) !== undefined
  ctx.parts.rename.setDisabled(!hasDeck)
  ctx.parts.remove.setDisabled(!hasDeck)
}

/** 卡池那一屏：每格摆一张卡，带上份数角标、灰卡牌子和「＋」的灰态。 */
function renderPool(ctx: DeckContext): void {
  const { layout, parts } = ctx
  const all = filteredPool(ctx)
  const scroll = layout.poolScroll
  if (scroll !== null) {
    ctx.poolScroll.setContent(scroll.view.height, contentHeight(layout.poolGrid, all.length))
  }
  const offset = scroll === null ? 0 : ctx.poolScroll.offset
  const shown = visiblePool(ctx)
  const deck = currentCards(ctx.state)
  const full = deck.length >= ctx.rules.size
  const drag = ctx.dragging

  parts.poolCells.forEach((cell, slot) => {
    const here = shown[slot]
    if (here === undefined) {
      // 这一屏没排满：多出来的格子整格藏起来。卡已经在 beginBorrow 那一步还回去了。
      cell.setCard(null)
      cell.visible = false
      cell.poolIndex = -1
      return
    }
    const rect = cellRect(layout.poolGrid, scroll === null ? slot : here.index)
    cell.position.set(rect.x, rect.y - offset)
    cell.poolIndex = here.index
    /*
     * 正从这一格往外拖：整格藏起来。
     *
     * 藏整格而不是只藏卡：角标和「＋」留在原地的话，屏幕上会有一枚悬空的「×1」和一颗
     *「＋」压在一片空白上——那张牌明明已经跟着手指走了。旧版也是把原位整个藏起来的。
     */
    const lifted = drag !== null && drag.from === 'pool' && drag.index === here.index
    cell.setCard(lifted ? null : ctx.takeCard(here.entry.cardId, poolTagOf(here.entry.cardId)))
    cell.visible = !lifted
    const copies = copiesOf(deck, here.entry.cardId)
    const atMax = copies >= ctx.rules.maxCopies
    cell.setBlocked(here.entry.blockedReason)
    cell.setCopies(copies, atMax)
    cell.setAddDisabled(here.entry.blockedReason !== null || full || atMax)
  })

  if (parts.pager !== null) {
    const pages = poolPageCount(ctx)
    const page = currentPage(ctx)
    parts.pager.label.setLabel(`${page + 1} / ${pages}`)
    parts.pager.prev.setDisabled(page <= 0)
    parts.pager.next.setDisabled(page >= pages - 1)
  }
  if (parts.poolBar !== null && scroll !== null) {
    const span = thumbSpan(
      scroll.bar.height,
      ctx.poolScroll.view,
      ctx.poolScroll.content,
      ctx.poolScroll.offset,
    )
    parts.poolBar.setSpan(span.y, span.height)
  }
  parts.poolHint.setLabel(full ? POOL_HINT_FULL : POOL_HINT)
}

/** 牌组栏：20 个卡位、计数、进度条、确认钮。 */
function renderSide(ctx: DeckContext): void {
  const { layout, parts } = ctx
  const deck = currentCards(ctx.state)
  const entries = slotEntries(shownDeck(ctx), ctx.gap)
  const cards: (CardSprite | null)[] = entries.map((cardId, index) =>
    cardId === null ? null : ctx.takeCard(cardId, slotTagOf(index)),
  )
  parts.slots.place(cards)
  parts.slots.setGap(ctx.gap)

  const scroll = layout.slotScroll
  if (scroll !== null) {
    // 卡位恒是 20 格，所以这块内容的高度不随牌数变——滚到哪儿只由玩家决定。
    ctx.slotScroll.setContent(scroll.view.height, contentHeight(layout.slots, ctx.rules.size))
    parts.slots.scrollTo(ctx.slotScroll.offset)
    if (parts.slotBar !== null) {
      const span = thumbSpan(
        scroll.bar.height,
        ctx.slotScroll.view,
        ctx.slotScroll.content,
        ctx.slotScroll.offset,
      )
      parts.slotBar.setSpan(span.y, span.height)
    }
  }

  const shortfall = shortfallOf(deck, ctx.rules)
  parts.tally.setLabel(
    shortfall > 0
      ? `已选 ${deck.length} / ${ctx.rules.size} · 还差 ${shortfall} 张`
      : `已选 ${deck.length} / ${ctx.rules.size}`,
  )
  /*
   * 进度条是「外框一块、里面按比例撑开一块」。里面那块贴着外框内侧 2px，
   * 撑不到一整块时整个藏起来——画出来是一条比描边还细的线，看着像界面坏了。
   */
  const room = Math.max(1, layout.progress.width - 4)
  const filled = room * Math.min(1, deck.length / ctx.rules.size)
  parts.progress.fill.visible = filled >= 2
  if (parts.progress.fill.visible) {
    parts.progress.fill.setSize(filled, Math.max(1, layout.progress.height - 4))
  }
  parts.sideHint.setLabel(SIDE_HINT)
  parts.confirm.setDisabled(!isCompleteDeck(deck, ctx.rules))
}

/** 卡池那张卡在场景树上叫什么。一张卡在卡池里只出现一次，所以卡 id 就够认。 */
function poolTagOf(cardId: string): string {
  return `pool:${cardId}`
}

/** 牌组第 index 格那张卡叫什么。按格子编号而不是卡 id——同一张牌可以带三份。 */
function slotTagOf(index: number): string {
  return `slot:${index}`
}
