/**
 * 对局场景的语义锚点：把教程说得出的那几个名字换算成屏幕上的一块地方。
 *
 * 名字和整件事的来龙去脉见 `scenes/anchors.ts` 和 duelContract.ts 的 `DuelAnchorName`。
 * 这里只回答「它在哪儿」，不管圈出来之后画什么——那是 React 引导层的活（第 32 条）。
 *
 * 两种量法，各有各的理由：
 *
 * - **能量到节点的就量节点**（按钮、比分、Token 细条、手牌）。它们的大小跟着内容走
 *   （比分是几位数、手上几张牌），照版式算出来的数和真画出来的差得远。
 * - **战场那两排按版式算**。空场时那一排一个子节点都没有，量出来是个零面积的点，
 *   而「我方战场」这个概念在空场时照样存在——第 1 轮那句「AI 牌会留在场上」
 *   正是指着一排空格子说的。
 */

import type { InstanceId } from '@ai-duel/core'
import type { Container } from 'pixi.js'
import type { AnchorRect } from '../anchors'
import type { DuelAnchorName } from '../duelContract'
import type { DuelContext } from './context'

/**
 * 量一个节点占屏幕上哪一块。
 *
 * 藏着的、或者零面积的（还没摆上内容的空容器）一律当「答不上来」：
 * 引导层收到 null 会把这个目标整个跳过，比圈一个看不见的点强。
 */
function boundsOf(node: Container | null): AnchorRect | null {
  if (node === null || !node.visible) return null
  const bounds = node.getBounds()
  if (bounds.width <= 0 || bounds.height <= 0) return null
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

/**
 * 战场上下两排各占哪一块（视口坐标）。
 *
 * 版式给的 `board` 是整块战场的外框（左上角 + 宽高，见 layout/types.ts），
 * 中线画在它正中（`BoardGrid` 的 layout），所以上下一人一半。
 */
function boardHalf(ctx: DuelContext, side: 'mine' | 'theirs'): AnchorRect {
  const { board } = ctx.layout
  const half = board.height / 2
  return {
    x: board.x,
    y: board.y + (side === 'mine' ? half : 0),
    width: board.width,
    height: half,
  }
}

/** 某个语义锚点现在占哪一块。答不上来返回 null。 */
export function anchorRectOf(ctx: DuelContext, name: DuelAnchorName): AnchorRect | null {
  const { parts } = ctx
  switch (name) {
    case 'endTurnButton':
      // 等对方出牌时这颗钮让位给「催一催」（两颗摞在同一处），那时它是藏着的。
      return boundsOf(parts.endPlay)
    case 'tokenCounter':
      return boundsOf(parts.panels.mine.tokenRail)
    case 'questionCategoryPanel':
      // 手机档没有侧栏，这一档整个答不上来，引导层会跳过它。
      return boundsOf(parts.sideBar?.nextPlaque ?? null)
    case 'scoreBoard':
      return boundsOf(parts.topBar.centerArea)
    case 'hand':
      // 手牌容器本身是条零高的基线，牌全是绝对摆出去的，所以量的是它的子节点并集
      //（`getBounds` 本来就这么算）。一张牌都没有时答不上来。
      return boundsOf(parts.fan)
    case 'battlefieldMine':
      return boardHalf(ctx, 'mine')
    case 'battlefieldFoe':
      return boardHalf(ctx, 'theirs')
  }
}

/** 手上那张牌占哪一块。牌不在手上（打出去了、还没发到）时返回 null。 */
export function handCardRectOf(ctx: DuelContext, instanceId: InstanceId): AnchorRect | null {
  for (const card of ctx.parts.fan.all()) {
    if (card.instanceId === instanceId) return boundsOf(card)
  }
  return null
}
