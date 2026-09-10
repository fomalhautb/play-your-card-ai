/**
 * 桌面档的牌组编辑版式：**左卡池、右牌组栏**，两块并排铺满一屏。
 *
 * 和旧版同一个骨架（`.deck-frame` 里左边 `.deck-pool` 右边 `.deck-side`），
 * 但尺寸不再是 1672×941 那一套死数：那一版整页只有一套版式、靠 `transform: scale()`
 * 缩到屏幕里；这一版按视口算，两档并列（需求第 3 条）。
 *
 * 卡池一页 4 列 × 2 行 = 8 张，翻页而不是滚动，理由见 logic/pagination.ts。
 * 牌组栏 5 列 × 4 行 = 20 格，和牌组张数一样多，所以永远一屏摆得下，不用翻页。
 */

import { tokens } from '@ai-duel/design'
import {
  cardScaleFor,
  centeredGrid,
  clamp,
  DESKTOP_TOP_BAR,
  type DeckLayout,
  fitCellWidth,
  HINT_HEIGHT,
  PAGE_PAD,
  PAGER_HEIGHT,
  POOL_GAP,
  POOL_HEAD_HEIGHT,
  SLOT_GAP,
} from './types'

/** 卡池一页几列几行。4 列是旧版 `.deck-grid` 的列数；2 行是「一屏刚好看完一页」的高度。 */
const POOL_SHAPE = { columns: 4, rows: 2, gapX: POOL_GAP.x, gapY: POOL_GAP.y }
/**
 * 牌组栏 5 列 × 4 行，正好 20 格。
 *
 * 旧版是 **2 列 × 10 行**加一条滚动条，而这一版不做滚动（理由同卡池，见 logic/pagination.ts），
 * 20 格必须一屏摆下。侧栏只有三四百宽、四五百高，2 列的话每格会被高度挤到二十来像素
 * ——那已经不是卡，是色块了。摊成 5 列之后每格六七十像素，看得出是哪张牌。
 */
const SLOT_SHAPE = { columns: 5, rows: 4, gapX: SLOT_GAP.x, gapY: SLOT_GAP.y }

/** 牌组栏占多宽。夹在上下限之间：太窄两列卡挤成条，太宽卡池就没地方了。 */
const SIDE_WIDTH_RATIO = 0.3
const SIDE_WIDTH_MIN = 320
const SIDE_WIDTH_MAX = 460

/** 牌组栏里几行东西各占多高：页签、管理行、计数、进度条、确认钮。 */
const TABS_HEIGHT = 30
const MANAGE_HEIGHT = 26
const TALLY_HEIGHT = 24
const PROGRESS_HEIGHT = 10
const CONFIRM_HEIGHT = tokens.size.plaque.endTurnHeight
/** 牌组栏里上下两行之间留多宽。 */
const ROW_GAP = 10
/** 底板四周的内边距。 */
const INNER_PAD = 14
/** 头部条左右各留多宽。 */
const HEAD_PAD = 12

export function desktopLayout(width: number, height: number): DeckLayout {
  const topBarHeight = DESKTOP_TOP_BAR
  const sideWidth = clamp(width * SIDE_WIDTH_RATIO, SIDE_WIDTH_MIN, SIDE_WIDTH_MAX)
  const bodyY = topBarHeight + PAGE_PAD
  const bodyHeight = Math.max(1, height - bodyY - PAGE_PAD)

  const pool = {
    x: PAGE_PAD,
    y: bodyY,
    width: Math.max(1, width - sideWidth - PAGE_PAD * 3),
    height: bodyHeight,
  }
  const poolHead = { x: pool.x, y: pool.y, width: pool.width, height: POOL_HEAD_HEIGHT }
  // 桌面档头部条一行：种类页签靠左，阵营药丸靠右，各自竖向居中。
  const headRowY = poolHead.y + POOL_HEAD_HEIGHT / 2
  const poolHint = {
    x: pool.x,
    y: pool.y + pool.height - HINT_HEIGHT,
    width: pool.width,
    height: HINT_HEIGHT,
  }
  const pagerY = poolHint.y - PAGER_HEIGHT
  // 网格夹在头部条和翻页行之间，四周再留一圈内边距。
  const poolArea = {
    x: pool.x + INNER_PAD,
    y: poolHead.y + poolHead.height,
    width: pool.width - INNER_PAD * 2,
    height: Math.max(1, pagerY - (poolHead.y + poolHead.height)),
  }
  const poolCell = fitCellWidth(poolArea, POOL_SHAPE)
  const poolGrid = centeredGrid(poolArea, POOL_SHAPE, poolCell)

  const side = { x: width - sideWidth - PAGE_PAD, y: bodyY, width: sideWidth, height: bodyHeight }
  const rowX = side.x + INNER_PAD
  const rowWidth = side.width - INNER_PAD * 2
  const tabs = { x: rowX, y: side.y + INNER_PAD, width: rowWidth, height: TABS_HEIGHT }
  const manageY = tabs.y + tabs.height + ROW_GAP
  const tallyY = manageY + MANAGE_HEIGHT + ROW_GAP
  const progress = {
    x: rowX,
    y: tallyY + TALLY_HEIGHT,
    width: rowWidth,
    height: PROGRESS_HEIGHT,
  }
  const confirmY = side.y + side.height - INNER_PAD - CONFIRM_HEIGHT
  const sideHint = {
    x: rowX,
    y: confirmY - ROW_GAP - HINT_HEIGHT,
    width: rowWidth,
    height: HINT_HEIGHT,
  }
  const slotArea = {
    x: rowX,
    y: progress.y + progress.height + ROW_GAP,
    width: rowWidth,
    height: Math.max(1, sideHint.y - ROW_GAP - (progress.y + progress.height + ROW_GAP)),
  }
  const slotCell = fitCellWidth(slotArea, SLOT_SHAPE)
  const slots = centeredGrid(slotArea, SLOT_SHAPE, slotCell)

  return {
    tier: 'desktop',
    width,
    height,
    topBarHeight,
    back: { x: PAGE_PAD, y: (topBarHeight - 24) / 2 },
    title: { x: PAGE_PAD + 120, y: topBarHeight / 2 },
    pool,
    poolHead,
    poolKinds: { x: poolHead.x + HEAD_PAD, y: headRowY },
    poolFactions: { x: 0, y: headRowY, right: poolHead.x + poolHead.width - HEAD_PAD },
    poolGrid,
    poolHint,
    pager: {
      prev: { x: pool.x + INNER_PAD, y: pagerY + 4 },
      next: { x: pool.x + pool.width - INNER_PAD - 64, y: pagerY + 4 },
      label: { x: pool.x + pool.width / 2, y: pagerY + PAGER_HEIGHT / 2 },
    },
    poolCardScale: cardScaleFor(poolCell),
    side,
    // 桌面档牌组栏一直摊着，没有「收起来」这一说。
    drawer: null,
    drawerOffset: 0,
    tabs,
    manage: { x: rowX, y: manageY },
    tally: { x: rowX, y: tallyY },
    progress,
    slots,
    sideHint,
    confirm: { x: side.x + side.width / 2, y: confirmY + CONFIRM_HEIGHT / 2 },
    slotCardScale: cardScaleFor(slotCell),
    revealScale: tokens.size.card.revealScale,
  }
}
