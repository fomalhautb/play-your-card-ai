/**
 * 构筑页对新手教程开出来的口子（迁移第 32 条）：一道放行闸门，加一组语义锚点。
 *
 * 闸门挡的是**动手**那几件事（加牌、移除、改名 / 新建 / 删除、换一套牌组），
 * 不挡看：翻页、点卡放大、切筛选照常——教学的三步都在默认筛选下看得见
 *（种类页签默认「全部」、阵营默认不选），玩家自己翻到别处再翻回来也不会卡住。
 *
 * 正式构筑页从头到尾 `ctx.tutorial` 都是 null，这里的每个判断都是一次 `=== null`。
 */

import type { CardId } from '@ai-duel/core'
import type { AnchorRect } from '../anchors'
import type { DeckAnchor, DeckTutorialGate } from '../deckContract'
import type { DeckContext } from './context'
import { clampPage } from './logic/pagination'
import { filterPool } from './logic/types'
import { type DeckState, setDrawerOpen, setPage } from './state'

/**
 * 进 / 出新手教程的组牌一段。
 *
 * 设闸门的同时顺手把画面摆到「看得见目标」的状态：翻到那张卡所在的那一页，
 * 手机档再把牌组抽屉升起来（计数和「确认牌组」都在那一层上）。
 * 不这么做的话引导圈会画在一片空处，而玩家根本不知道该往哪儿翻——
 * 这一段翻页是放行的，但没人会去猜。
 *
 * @param change 场景那条「改一次状态并重排画面」。走它而不是直接写 `ctx.state`，
 *               否则改完画面不跟着动。
 */
export function applyDeckTutorial(
  ctx: DeckContext,
  gate: DeckTutorialGate | null,
  change: (next: (state: DeckState) => DeckState) => void,
): void {
  ctx.tutorial = gate
  const cardId = gate?.allowedCardId ?? null
  change((state) => {
    const page = cardId === null ? state.page : (pageOfCard(ctx, cardId) ?? state.page)
    return setDrawerOpen(setPage(state, page), gate === null ? state.drawerOpen : true)
  })
}

/**
 * 这一下被教学闸门挡住了吗。挡住的话顺手把那句话说出去——
 * 教学阶段的锁必须有话说，否则玩家只会觉得界面坏了。
 */
export function blockedByTutorial(ctx: DeckContext, cardId: CardId | null): boolean {
  const gate = ctx.tutorial
  if (gate === null) return false
  // cardId 为 null 是「移除 / 改名 / 换牌组」这类整段教学都关着的操作。
  if (cardId !== null && gate.allowedCardId === cardId) return false
  ctx.blocked(gate.blockTip)
  return true
}

/**
 * 这张卡在筛完之后的第几页上。卡池里根本没有它（筛掉了、或者不在卡池）时返回 null。
 *
 * 算的是**当前筛选下**的分页，和界面上看到的完全一致——教学期间筛选停在默认那一档，
 * 所以这里算出来的页码就是玩家翻过去会看到那张卡的那一页。
 */
export function pageOfCard(ctx: DeckContext, cardId: CardId): number | null {
  const shown = filterPool(ctx.pool, ctx.state.kind, ctx.state.faction)
  const index = shown.findIndex((one) => one.cardId === cardId)
  const perPage = ctx.parts.poolCells.length
  if (index < 0 || perPage <= 0) return null
  return clampPage(Math.floor(index / perPage), shown.length, perPage)
}

/** 两块地方并起来的外框。计数那一处是「一行字 + 一条进度条」，得合着圈才完整。 */
function union(boxes: (AnchorRect | null)[]): AnchorRect | null {
  const kept = boxes.filter((box): box is AnchorRect => box !== null)
  const first = kept[0]
  if (first === undefined) return null
  let left = first.x
  let top = first.y
  let right = first.x + first.width
  let bottom = first.y + first.height
  for (const box of kept.slice(1)) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width)
    bottom = Math.max(bottom, box.y + box.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 量一个节点。藏着的、零面积的一律当「答不上来」，引导层会把这个目标跳过。 */
function boundsOf(node: { visible: boolean; getBounds(): AnchorRect } | null): AnchorRect | null {
  if (node === null || !node.visible) return null
  const bounds = node.getBounds()
  if (bounds.width <= 0 || bounds.height <= 0) return null
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

/** 某个高亮目标现在占哪一块。答不上来返回 null。 */
export function deckAnchorRectOf(ctx: DeckContext, target: DeckAnchor): AnchorRect | null {
  const { parts } = ctx
  if (target.kind === 'anchor') {
    if (target.name === 'deckConfirm') return boundsOf(parts.confirm)
    return union([boundsOf(parts.tally), boundsOf(parts.progress)])
  }
  /*
   * 卡池那一格。量格子而不是量卡：格子是长住的（翻页只换里面那张卡），
   * 位置稳定；而卡还可能正被借去别处摆着。
   */
  const shown = filterPool(ctx.pool, ctx.state.kind, ctx.state.faction)
  const perPage = parts.poolCells.length
  const page = pageOfCard(ctx, target.cardId)
  if (page === null || page !== clampPage(ctx.state.page, shown.length, perPage)) return null
  const index = shown.findIndex((one) => one.cardId === target.cardId) % perPage
  return boundsOf(parts.poolCells[index] ?? null)
}
