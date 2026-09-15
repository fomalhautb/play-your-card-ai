/**
 * 「那张牌此刻画在舞台的哪儿」——飞行的起点和落点全从这里取。
 *
 * 三处要用同一个答案：拖拽松手之后往哪儿飞（input / drop.ts）、放大查看从哪儿飞来飞回
 *（DeckScene 喂给 inspect）、加不进去时浮字停在哪儿（refuse）。各算一遍的话，
 * 飞进去的和飞出来的会对不上半格——而滚动那一档还要再减一次滚动量，更容易漏。
 *
 * 全是读上下文算数，不碰状态。
 */

import type { CardId } from '@ai-duel/core'
import type { CardSprite } from '../../components/CardSprite'
import type { RevealPoint } from '../../components/RevealOverlay'
import { CARD_HEIGHT } from '../../layout/fanMath'
import { cellRect } from '../../layout/gridMath'
import type { DeckContext } from './context'
import type { InspectOrigin } from './inspect'
import { filteredPool, visiblePool } from './render'

/** 送回卡池时落点那张牌不在视野里，就落到卡池窗口的右下角，离边留这么远（黑客松的 `POOL_CORNER_INSET`）。 */
const POOL_CORNER_INSET = 22

/** 卡的原点在底边中点，所以让卡心落在某个点上时，容器要摆到那个点往下半张卡的地方。 */
export function anchorFor(centerX: number, centerY: number, scale: number): RevealPoint {
  return { x: centerX, y: centerY + (CARD_HEIGHT * scale) / 2, scale }
}

/** 卡池里筛完之后第 index 张此刻的卡心。滚出视野就退到卡池窗口的右下角（同黑客松）。 */
export function poolAnchor(ctx: DeckContext, index: number): { x: number; y: number } {
  const scroll = ctx.layout.poolScroll
  const shown = visiblePool(ctx)
  const slot = shown.findIndex((one) => one.index === index)
  if (slot >= 0) {
    const rect = cellRect(ctx.layout.poolGrid, scroll === null ? slot : index)
    const offset = scroll === null ? 0 : ctx.poolScroll.offset
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 - offset }
  }
  const area = scroll?.view ?? ctx.layout.pool
  return {
    x: area.x + area.width - POOL_CORNER_INSET,
    y: area.y + area.height - POOL_CORNER_INSET,
  }
}

/** 牌组第 index 格此刻的卡心。 */
export function slotAnchor(ctx: DeckContext, index: number): { x: number; y: number } {
  const center = ctx.parts.slots.centerOf(index)
  return { x: center.x, y: center.y - ctx.slotScroll.offset }
}

/** 卡池里此刻摆着这张牌的那一格里那张卡。滚出视野、或者被筛掉了就没有。 */
export function poolCardOf(ctx: DeckContext, cardId: CardId): CardSprite | null {
  const index = filteredPool(ctx).findIndex((one) => one.cardId === cardId)
  if (index < 0) return null
  return ctx.parts.poolCells.find((one) => one.poolIndex === index)?.shown ?? null
}

/** 放大查看的起点 / 落点：那张牌此刻画在哪儿、此刻多大。 */
export function originPointOf(ctx: DeckContext, origin: InspectOrigin): RevealPoint {
  const scale = origin.from === 'pool' ? ctx.layout.poolCardScale : ctx.layout.slotCardScale
  const center =
    origin.from === 'pool' ? poolAnchor(ctx, origin.index) : slotAnchor(ctx, origin.index)
  return anchorFor(center.x, center.y, scale)
}
