/**
 * 按版式把构筑页那一套零件摆一遍。
 *
 * 从 parts.ts 里拎出来的（400 行那条上限逼的，见架构 7.2 第 3 条）：那边回答「有哪些零件」，
 * 这边回答「它们摆在哪儿」。尺寸一变就要重画的那几块（两块外框、提示条、进度条、格子底）
 * 由场景重建零件负责（见 DeckScene 的 rebuild），这里只摆位置和那几处要量出来才知道的宽。
 */

import { CARD_HEIGHT } from '../../layout/fanMath'
import type { DeckLayout } from './layout/types'
import {
  type DeckParts,
  TITLE_BOX,
  TITLE_GAP,
  ZOOM_ACTION,
  ZOOM_ANCHOR_Y,
  ZOOM_BACK_X,
} from './partsSpec'

/**
 * 按版式把所有零件摆一遍。改视口和换档位都走这里。
 *
 * 尺寸一变就要重画的那几块（两块外框、提示条、进度条、格子底）由场景重建零件负责
 *（见 DeckScene 的 rebuild），这里只摆位置和那几处要量出来才知道的宽。
 */
export function applyDeckLayout(parts: DeckParts, layout: DeckLayout): void {
  parts.back.position.set(layout.back.x, layout.back.y)
  /*
   * 标题排在返回钮之后。版式给的 `title.x` 只是一个下限——返回钮的宽度由这里定，
   * 版式算不出来，所以在这儿取两者的大的那个。
   */
  parts.title.position.set(
    Math.max(layout.title.x, layout.back.x + parts.back.boxWidth + TITLE_GAP),
    layout.title.y - TITLE_BOX.height / 2,
  )

  parts.pool.position.set(layout.pool.x, layout.pool.y)
  // 两排页签的**竖向**位置：版式给的是那一行的中线，扣掉半个高就是左上角。
  parts.kindTabs.position.set(layout.poolKinds.x, layout.poolKinds.y - parts.kindTabs.boxHeight / 2)
  parts.factionTabs.position.set(
    layout.poolFactions.x,
    layout.poolFactions.y - parts.factionTabs.boxHeight / 2,
  )
  parts.poolCells.forEach((cell) => {
    cell.resize(layout.poolGrid.cellWidth, layout.poolGrid.cellHeight, layout.poolCardScale)
  })
  const view = layout.poolScroll?.view
  if (parts.poolClip !== null && view !== undefined) {
    parts.poolClip.clear().rect(view.x, view.y, view.width, view.height).fill({ color: 0xffffff })
  }
  parts.poolHint.setSize(layout.poolHint.width, layout.poolHint.height)
  parts.poolHint.position.set(layout.poolHint.x, layout.poolHint.y)
  if (parts.pager !== null && layout.pager !== null) {
    parts.pager.prev.position.set(layout.pager.prev.x, layout.pager.prev.y)
    parts.pager.next.position.set(layout.pager.next.x, layout.pager.next.y)
    parts.pager.label.position.set(
      layout.pager.label.x - parts.pager.label.boxWidth / 2,
      layout.pager.label.y - parts.pager.label.boxHeight / 2,
    )
  }

  parts.side.position.set(layout.side.x, layout.side.y)
  parts.deckTabs.position.set(layout.tabs.x, layout.tabs.y)
  parts.newDeck.position.set(
    layout.tabs.x + layout.tabs.width - parts.newDeck.boxWidth,
    layout.tabs.y,
  )
  const handle = layout.drawer?.handle
  parts.drawerHandle.visible = handle !== undefined
  if (handle !== undefined) parts.drawerHandle.position.set(handle.x, handle.y)
  parts.rename.position.set(layout.manage.x, layout.manage.y)
  parts.remove.position.set(layout.manage.x + parts.rename.boxWidth + 8, layout.manage.y)
  parts.tally.position.set(layout.tally.x, layout.tally.y)
  parts.progress.track.setSize(layout.progress.width, layout.progress.height)
  parts.progress.track.position.set(layout.progress.x, layout.progress.y)
  parts.progress.fill.position.set(layout.progress.x + 2, layout.progress.y + 2)
  parts.slots.resize(layout.slots, layout.slotCardScale, layout.slotScroll?.view ?? null)
  parts.slots.position.set(0, 0)
  parts.sideHint.setSize(layout.sideHint.width, layout.sideHint.height)
  parts.sideHint.position.set(layout.sideHint.x, layout.sideHint.y)
  parts.confirm.position.set(
    layout.confirm.x - parts.confirm.boxWidth / 2,
    layout.confirm.y - parts.confirm.boxHeight / 2,
  )
  parts.reveal.resize(layout.width, layout.height)

  // 那一行操作钮排在背面大卡的正下方，两颗左右对称地夹着 61% 那条线。
  const actionsY =
    layout.height * ZOOM_ANCHOR_Y + (CARD_HEIGHT * layout.revealScale) / 2 + ZOOM_ACTION.top
  const half = ZOOM_ACTION.width + ZOOM_ACTION.gap / 2
  parts.zoomActions.add.position.set(layout.width * ZOOM_BACK_X - half, actionsY)
  parts.zoomActions.close.position.set(layout.width * ZOOM_BACK_X + ZOOM_ACTION.gap / 2, actionsY)
}
