/**
 * 手机档的牌组编辑版式：**上卡池、下抽屉**。
 *
 * 和桌面档真正分岔的三处：
 * 1. 卡池网格从 4 列减到 **3 列**（一行四张在 390 宽上每张只剩八十来像素，卡名认不出来）；
 * 2. 牌组栏不再是右边竖着一整条，而是**折叠成底部抽屉**：收起来只露最上面一条
 *    （把手 + 「已选 N / 20」+ 进度条），点一下才整块升上来盖住卡池；
 *    展开之后 20 个卡位排成 4 列 × 5 行（竖着两列在这块高度里排不下）；
 * 3. 卡跟着格子一起小一档。
 *
 * 抽屉而不是「上下各占一半」：两块都摊着的话，卡池只剩三分之一屏，一页看不到几张牌，
 * 而构筑的绝大多数时间是在卡池里找卡，牌组栏只在加牌和检查张数时看一眼。
 *
 * ## 收起来 = 整块往下挪
 *
 * 抽屉只有**一块**面板，收起来不是换一块小的，而是把整层往下挪 `drawerOffset`，
 * 于是最上面那一条正好停在屏幕底边上。所以这一档的行序和桌面档不同：
 * 「已选 N / 20」和进度条排在**最上面**（收起来时露出来的就是它们），
 * 页签、管理行、卡位、确认钮排在下面。
 * 这样开关抽屉只是写一个 y，一块底板都不用重画（3.10）。
 *
 * 这一档**不缩放、不滚动**：舞台坐标就是视口坐标（`stage.scale` 恒为 1），
 * 卡池翻页、20 个卡位一屏摆下。桌面档那两样（死版式整块缩放、两块纵向滚动区）
 * 是它自己的事，见 desktopLayout.ts——两档并列，这次一个数都没动。
 */

import { tokens } from '@ai-duel/design'
import {
  cardScaleFor,
  centeredGrid,
  type DeckLayout,
  fitCellWidth,
  HINT_HEIGHT,
  MOBILE_TOP_BAR,
  PAGER_HEIGHT,
  POOL_GAP,
  POOL_HEAD_HEIGHT,
  SLOT_GAP,
} from './types'

/** 卡池一页 3 列 × 2 行 = 6 张。 */
const POOL_SHAPE = { columns: 3, rows: 2, gapX: POOL_GAP.x, gapY: POOL_GAP.y }
/** 抽屉展开之后 4 列 × 5 行，正好 20 格。 */
const SLOT_SHAPE = { columns: 4, rows: 5, gapX: SLOT_GAP.x, gapY: SLOT_GAP.y }

/** 手机档四周留多宽。比桌面档窄——这块屏本来就没多少地方。 */
const PAGE_PAD = 12
/** 底板内边距。 */
const INNER_PAD = 10
/** 头部条左右各留多宽。 */
const HEAD_PAD = 10
/**
 * 抽屉展开之后占屏幕多高。
 *
 * 九成，也就是**基本铺满**。20 个卡位不做滚动（理由同卡池，见 logic/pagination.ts），
 * 要在竖屏里排成 4 列 × 5 行还让每格有六十几像素宽，只能给它这么多高度。
 * 反正抽屉一打开玩家就是在看牌组，卡池那时候不用露出来。
 */
const DRAWER_RATIO = 0.9
/** 抽屉里几行东西各占多高。 */
const HANDLE_HEIGHT = 26
const TALLY_HEIGHT = 22
const PROGRESS_HEIGHT = 8
const TABS_HEIGHT = 28
const MANAGE_HEIGHT = 24
const CONFIRM_HEIGHT = tokens.size.plaque.playHeight
const ROW_GAP = 8

/** 收起来时露出来那一条有多高：内边距 + 把手那一行 + 进度条 + 内边距。 */
const COLLAPSED_HEIGHT =
  INNER_PAD * 2 + Math.max(HANDLE_HEIGHT, TALLY_HEIGHT) + ROW_GAP + PROGRESS_HEIGHT

export function mobileLayout(width: number, height: number): DeckLayout {
  const topBarHeight = MOBILE_TOP_BAR
  const bodyY = topBarHeight + PAGE_PAD
  const collapsedTop = height - COLLAPSED_HEIGHT

  const pool = {
    x: PAGE_PAD,
    y: bodyY,
    width: Math.max(1, width - PAGE_PAD * 2),
    height: Math.max(1, collapsedTop - bodyY - PAGE_PAD),
  }
  /*
   * 手机档头部条**两行高**：390 宽上，三个种类页签加一排阵营药丸挤在一行里必然叠上，
   * 所以阵营那一排另起一行。这是两档版式又一处真正的分岔，不是缩放。
   */
  const headHeight = POOL_HEAD_HEIGHT * 2
  const poolHead = { x: pool.x, y: pool.y, width: pool.width, height: headHeight }
  const poolHint = {
    x: pool.x,
    y: pool.y + pool.height - HINT_HEIGHT,
    width: pool.width,
    height: HINT_HEIGHT,
  }
  const pagerY = poolHint.y - PAGER_HEIGHT
  const poolArea = {
    x: pool.x + INNER_PAD,
    y: poolHead.y + poolHead.height,
    width: pool.width - INNER_PAD * 2,
    height: Math.max(1, pagerY - (poolHead.y + poolHead.height)),
  }
  const poolCell = fitCellWidth(poolArea, POOL_SHAPE)
  const poolGrid = centeredGrid(poolArea, POOL_SHAPE, poolCell)

  const expandedHeight = Math.max(COLLAPSED_HEIGHT, Math.round(height * DRAWER_RATIO))
  const side = { x: 0, y: height - expandedHeight, width, height: expandedHeight }
  const collapsed = { x: 0, y: collapsedTop, width, height: COLLAPSED_HEIGHT }

  const rowX = side.x + INNER_PAD
  const rowWidth = side.width - INNER_PAD * 2
  // 最上面那一条：把手在左，「已选 N / 20」跟在后面，下面一条进度条。收起来时露的就是这些。
  const handle = { x: rowX, y: side.y + INNER_PAD }
  const tallyY = side.y + INNER_PAD
  const progress = {
    x: rowX,
    y: tallyY + Math.max(HANDLE_HEIGHT, TALLY_HEIGHT) + ROW_GAP,
    width: rowWidth,
    height: PROGRESS_HEIGHT,
  }
  const tabs = {
    x: rowX,
    y: progress.y + progress.height + ROW_GAP,
    width: rowWidth,
    height: TABS_HEIGHT,
  }
  const manageY = tabs.y + tabs.height + ROW_GAP
  const confirmY = side.y + side.height - INNER_PAD - CONFIRM_HEIGHT
  const sideHint = {
    x: rowX,
    y: confirmY - ROW_GAP - HINT_HEIGHT,
    width: rowWidth,
    height: HINT_HEIGHT,
  }
  const slotTop = manageY + MANAGE_HEIGHT + ROW_GAP
  const slotArea = {
    x: rowX,
    y: slotTop,
    width: rowWidth,
    height: Math.max(1, sideHint.y - ROW_GAP - slotTop),
  }
  const slotCell = fitCellWidth(slotArea, SLOT_SHAPE)
  const slots = centeredGrid(slotArea, SLOT_SHAPE, slotCell)

  return {
    tier: 'mobile',
    width,
    height,
    // 这一档按视口实算，舞台就是视口本身，所以不缩放也没有偏移。
    viewport: { width, height },
    stage: { scale: 1, x: 0, y: 0 },
    topBarHeight,
    back: { x: PAGE_PAD, y: (topBarHeight - 20) / 2 },
    // 手机档标题紧挨着返回钮，没有副标题的地方。
    title: { x: PAGE_PAD + 64, y: topBarHeight / 2 },
    pool,
    poolHead,
    poolKinds: { x: poolHead.x + HEAD_PAD, y: poolHead.y + POOL_HEAD_HEIGHT / 2 },
    // 靠左另起一行。
    poolFactions: { x: poolHead.x + HEAD_PAD, y: poolHead.y + POOL_HEAD_HEIGHT * 1.5 },
    poolGrid,
    // 这一档翻页，不滚动。
    poolScroll: null,
    poolHint,
    pager: {
      prev: { x: pool.x + INNER_PAD, y: pagerY + 2 },
      next: { x: pool.x + pool.width - INNER_PAD - 56, y: pagerY + 2 },
      label: { x: pool.x + pool.width / 2, y: pagerY + PAGER_HEIGHT / 2 },
    },
    poolCardScale: cardScaleFor(poolCell),
    side,
    drawer: { collapsed, expanded: side, handle },
    // 收起来就是整层往下挪这么多，最上面那一条正好停在屏幕底边上。
    drawerOffset: expandedHeight - COLLAPSED_HEIGHT,
    tabs,
    manage: { x: rowX, y: manageY },
    tally: { x: rowX + 72, y: tallyY },
    progress,
    slots,
    // 4 列 × 5 行正好 20 格，一屏摆得下，不滚动。
    slotScroll: null,
    sideHint,
    confirm: { x: side.x + side.width / 2, y: confirmY + CONFIRM_HEIGHT / 2 },
    slotCardScale: cardScaleFor(slotCell),
    // 触屏档放得更大：手指按住的那块地方本来就挡掉一片。
    revealScale: tokens.size.card.revealScaleTouch,
  }
}
