/**
 * 两处要跨坐标系换算的几何：战场某一格在视口里的位置，以及牌库在手牌容器里的位置。
 *
 * 分开放是因为它们都要同时读版式和组件，而版式模块只认数、组件只认自己那套坐标——
 * 谁也不该反过来认识对方。
 */

import { tokens } from '@ai-duel/design'
import type { BoardGrid } from '../../components/BoardGrid'
import type { RevealPoint } from '../../components/RevealOverlay'
import type { DuelLayout } from './layout/types'
import { boardToWorld, toFanLocal } from './layout/types'

/** 某个格子在**视口坐标**里的中心、尺寸，以及卡落在那儿该有的缩放。 */
export function tilePointOf(
  layout: DuelLayout,
  board: BoardGrid,
  instanceId: string,
): (RevealPoint & { width: number; height: number }) | null {
  const local = board.tileAt(instanceId)
  if (local === null) return null
  const center = boardToWorld(layout, local)
  const scale = layout.board.scale
  return {
    x: center.x,
    y: center.y,
    // 战场整块缩过一次（两档版式的格子尺寸不同），落到格子上的卡要跟着缩同样多。
    scale: tokens.size.card.tileScale * scale,
    width: local.width * scale,
    height: local.height * scale,
  }
}

/** 牌库那摞牌此刻的姿态，换算到**手牌容器**的坐标系里——发牌就是从这个姿态起飞的。 */
export function deckPoseOf(layout: DuelLayout): {
  x: number
  y: number
  rotation: number
  scale: number
} {
  const { deck, hand } = layout
  const local = toFanLocal(layout, deck.x, deck.y)
  // 牌库上的牌是正着摞的，扇形的倾角留给飞行途中转出来。
  return { x: local.x, y: local.y, rotation: 0, scale: deck.scale / hand.scale }
}
