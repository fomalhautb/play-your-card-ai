/**
 * 把这一局在画面上留下的东西全部收掉，不播任何退场。
 *
 * 三处用它：换一局（契约的 `reset`）、换档位重建零件、拆场景。
 * 它们的共同点是「上一局的场面不该再出现」——所以走的是当场清掉那条路，
 * 不是各组件自己的退场动画（那些是演出，而演出这时候已经没有意义了）。
 *
 * **销毁之前必须先把补间掐掉**，否则下一帧 GSAP 会在一个已经拆掉的对象上取属性、当场抛错。
 * 这一条特别容易踩空的地方是手牌：从扇形里摘一张，剩下的会当场重排——
 * 也就是给「马上就要被销毁的下一张」新建了一条补间。所以下面是**先全摘完、再统一销毁**。
 */

import type { DuelContext } from './context'
import { killAndDestroy } from './disposal'

export function clearScene(ctx: DuelContext): void {
  const { animator } = ctx.deps
  const { parts } = ctx

  for (const [, leaving] of ctx.leaving) killAndDestroy(animator, leaving.card)
  ctx.leaving.clear()
  if (ctx.showcased !== null) killAndDestroy(animator, ctx.showcased)
  ctx.showcased = null
  ctx.inspectingTile = null
  ctx.pendingHand.length = 0
  ctx.pendingFoeDeal = 0
  ctx.doomedTiles.clear()
  ctx.hiddenTiles.clear()
  ctx.handCardIds.clear()
  ctx.markKeys.clear()
  ctx.locks.clear()

  // 先把整排摘干净再销毁，理由见文件头。
  const hand = [...parts.fan.all()]
  for (const card of hand) parts.fan.remove(card)
  for (const card of hand) killAndDestroy(animator, card)

  // 正飞着的那几张（出牌途中、放大查看途中）挂在拖拽层上，不在扇形里也不在等认领的表里。
  for (const child of parts.layers.drag.removeChildren()) killAndDestroy(animator, child)

  parts.board.clear()
  parts.foeHand.setCount(0)
  parts.settle.clear()
  parts.coin.clear()
  parts.cancel.clear()
  parts.banner.clear()
  parts.reveal.abort()
  parts.targeting.end()
}
