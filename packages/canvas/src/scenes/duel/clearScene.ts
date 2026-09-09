/**
 * 把这一局在画面上留下的东西全部收掉，不播任何退场。
 *
 * 三处用它：换一局（契约的 `reset`）、换档位重建零件、拆场景。
 * 它们的共同点是「上一局的场面不该再出现」——所以走的是当场清掉那条路，
 * 不是各组件自己的退场动画（那些是演出，而演出这时候已经没有意义了）。
 */

import type { DuelContext } from './context'

export function clearScene(ctx: DuelContext): void {
  for (const [, leaving] of ctx.leaving) {
    leaving.card.destroy({ children: true, texture: false, textureSource: false })
  }
  ctx.leaving.clear()
  ctx.showcased?.destroy({ children: true, texture: false, textureSource: false })
  ctx.showcased = null
  ctx.inspectingTile = null
  ctx.pendingHand.length = 0
  ctx.pendingFoeDeal = 0
  ctx.doomedTiles.clear()
  ctx.hiddenTiles.clear()
  ctx.handCardIds.clear()
  ctx.markKeys.clear()
  ctx.locks.clear()

  const { parts } = ctx
  for (const card of [...parts.fan.all()]) {
    parts.fan.remove(card)
    card.destroy({ children: true, texture: false, textureSource: false })
  }
  parts.board.clear()
  parts.foeHand.setCount(0)
  parts.settle.clear()
  parts.coin.clear()
  parts.cancel.clear()
  parts.banner.clear()
  parts.reveal.abort()
  parts.targeting.end()
}
