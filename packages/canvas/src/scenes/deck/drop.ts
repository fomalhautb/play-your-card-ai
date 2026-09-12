/**
 * 松手之后那三种去向：飞进牌组让出来的那一格、飞回卡池（= 移除）、飞回原位（= 什么都没发生）。
 *
 * 从 input.ts 里拎出来的（400 行那条上限逼的）：那边只管「这一下判成了什么」，
 * 这边管「演哪一段、落地之后改什么状态」。三条都遵同一条规矩：
 * **补间跑完之前状态不动**——牌还在半空，格子里就不该已经多出一份（同黑客松那句注释）。
 */

import type { CardId } from '@ai-duel/core'
import type { CardSprite } from '../../components/CardSprite'
import { anchorFor, poolAnchor, slotAnchor } from './anchors'
import type { DeckContext } from './context'
import { flyBackToPool, flyHome, flyIntoSlot } from './dragFx'
import { insertIndexAt } from './logic/insert'
import { addBlockReason } from './logic/legality'
import { filteredPool, renderDeckScene } from './render'
import { addCard, currentCards, removeAt } from './state'

/** 正被拖着的那一张。松手之后 `ghost` 的归属交给下面那三条，所以它是可写的。 */
export interface DragPress {
  origin: { from: 'pool' | 'deck'; cardId: CardId; index: number }
  ghost: CardSprite | null
}

/** 现在把这张牌加进牌组会被什么挡住。`null` 就是加得进去。 */
function blockedFor(ctx: DeckContext, cardId: CardId): string | null {
  return addBlockReason({
    deck: currentCards(ctx.state),
    cardId,
    rules: ctx.rules,
    blockedReason: ctx.pool.find((one) => one.cardId === cardId)?.blockedReason ?? null,
  })
}

/** 收掉跟手那张卡，恢复「没在拖」。飞行那三条各自接手 ghost，所以它们不走这条。 */
export function endDrag(ctx: DeckContext, state: DragPress): void {
  if (state.ghost !== null) {
    ctx.animator.killTweensOf(state.ghost)
    ctx.animator.killTweensOf(state.ghost.position)
    ctx.animator.killTweensOf(state.ghost.scale)
    ctx.releaseCard(state.ghost, state.origin.cardId)
  }
  state.ghost = null
  ctx.dragging = null
  ctx.gap = null
}

/** 松手落在牌组栏里：飞进让出来的那一格，落地才真的加进去。 */
export function dropIntoDeck(ctx: DeckContext, state: DragPress, x: number, y: number): void {
  const at =
    ctx.gap ??
    insertIndexAt({
      grid: ctx.layout.slots,
      deckLength: currentCards(ctx.state).length,
      gap: null,
      point: { x, y: y + ctx.slotScroll.offset },
    })
  const ghost = state.ghost
  if (ghost === null) {
    endDrag(ctx, state)
    renderDeckScene(ctx)
    return
  }
  if (blockedFor(ctx, state.origin.cardId) !== null) {
    /*
     * 加不进去：先摇头弹字，再把牌送回原位。
     *
     * 顺序不能反——`refuse` 摇的是**跟手那张**（玩家正盯着它），而送回原位那一程
     * 跑完就会把它还回回收池。两段动的是不同的属性（摇头写 rotation、飞行写 position
     * 和 scale），所以它们叠着演，不会互相顶掉。
     */
    ctx.refuse(state.origin.cardId, ghost)
    dropHome(ctx, state)
    return
  }
  // 让位那一格先留着：牌还在半空，格子塌回去的话它就是飞向一个不存在的地方。
  ctx.gap = at
  const center = slotAnchor(ctx, at)
  state.ghost = null
  flyIntoSlot(ctx.animator, ghost, anchorFor(center.x, center.y, ctx.layout.slotCardScale), () => {
    ctx.releaseCard(ghost, state.origin.cardId)
    ctx.gap = null
    ctx.dragging = null
    ctx.state = addCard(ctx.state, state.origin.cardId, at)
    ctx.emitChange()
    renderDeckScene(ctx)
  })
  renderDeckScene(ctx)
}

/** 松手落在牌组栏外面（从牌组里拖出来的那张）：飞回卡池，落地才真的移除。 */
export function dropBackToPool(ctx: DeckContext, state: DragPress): void {
  const ghost = state.ghost
  const index = state.origin.index
  const commit = (): void => {
    ctx.dragging = null
    ctx.state = removeAt(ctx.state, index)
    ctx.emitChange()
    renderDeckScene(ctx)
  }
  if (ghost === null) {
    endDrag(ctx, state)
    commit()
    return
  }
  const center = poolAnchor(
    ctx,
    filteredPool(ctx).findIndex((one) => one.cardId === state.origin.cardId),
  )
  state.ghost = null
  ctx.gap = null
  flyBackToPool(
    ctx.animator,
    ghost,
    anchorFor(center.x, center.y, ctx.layout.poolCardScale),
    () => {
      ctx.releaseCard(ghost, state.origin.cardId)
      commit()
    },
  )
  renderDeckScene(ctx)
}

/** 松手落在谁的地盘都不算：送回原来那一格。 */
export function dropHome(ctx: DeckContext, state: DragPress): void {
  const ghost = state.ghost
  if (ghost === null) {
    endDrag(ctx, state)
    renderDeckScene(ctx)
    return
  }
  const fromPool = state.origin.from === 'pool'
  const center = fromPool
    ? poolAnchor(ctx, state.origin.index)
    : slotAnchor(ctx, state.origin.index)
  const scale = fromPool ? ctx.layout.poolCardScale : ctx.layout.slotCardScale
  state.ghost = null
  ctx.gap = null
  flyHome(ctx.animator, ghost, anchorFor(center.x, center.y, scale), () => {
    ctx.releaseCard(ghost, state.origin.cardId)
    ctx.dragging = null
    renderDeckScene(ctx)
  })
  renderDeckScene(ctx)
}
