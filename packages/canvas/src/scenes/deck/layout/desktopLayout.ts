/**
 * 桌面档的牌组编辑版式：一块 1672×941 的死版式，整块等比缩放居中放进视口。
 *
 * 数全部照黑客松版的 `screens/deck.css` 来（正式版简化第 4 步之四把这一档还原成那一版）：
 * 顶栏 padding 16/30/12、两栏 `1fr / 496` gap 20 padding 0 30 24、
 * 卡池 4 列纵向滚动（列宽 249.5、行 gap 20 列 gap 18、padding 20/22/24）、
 * 筛选头两行 gap 14 padding 18/22/14、牌组栏 2 列 × 10 行纵向滚动（格 206×309、gap 10）。
 * 改任何一个数之前先回去核对那份样式表——这一档的每一行都对得上它的一条规则。
 *
 * 为什么回到死版式：这一页的每一块都是照 1672×941 量的（卡池列宽是拿「舞台宽减掉右栏、
 * 两栏间距和网格内边距」反算出来的，牌组格宽是拿右栏内宽反算出来的），按真实视口实算的话
 * 这些关系要各自重新推一遍，而窗口比例一变又对不上。整块缩放只写一个 transform。
 *
 * 为什么回到滚动：翻页是搬到画布上时为了省掉一层遮罩临时换的做法。代价是卡池被切成
 *「一页八张」，而这一页的主要动作恰恰是**在一长串牌里找**——翻页把「往下扫一眼」
 * 变成了「记住自己翻到第几页」。遮罩那点开销由离屏剔除抵掉：窗口里同时摆得下几行，
 * 就只建几行格子（多留一行给露头的那一行），滚动只改一个 y。
 *
 * 和手机档的关系是**并列**，不是缩放：那边卡池 3 列翻页、牌组栏折叠成底部抽屉，
 * 两处都在 mobileLayout.ts 里独立算（需求第 3 条），这次一个数都没动。
 */

import { tokens } from '@ai-duel/design'
import { CARD_HEIGHT, CARD_WIDTH } from '../../../layout/fanMath'
import type { GridSpec } from '../../../layout/gridMath'
import { cardScaleFor, type DeckLayout, HINT_HEIGHT, type Rect, SLOT_GAP } from './types'

/** 设计稿尺寸。和对局页同一块舞台（黑客松 `ui/battleStage.ts` 的 `BATTLE_STAGE_WIDTH / HEIGHT`）。 */
const DESIGN_WIDTH = 1672
const DESIGN_HEIGHT = 941

/**
 * 顶栏：`.deck-top` 的 `padding: 16px 30px 12px`，里面是一行 34 高的东西
 *（黑客松那行最高的是 34 的静音钮，正式版剥到只剩返回钮和标题，仍按同一行高排）。
 */
const TOP_PAD = { top: 16, bottom: 12 } as const
const TOP_ROW = 34
const TOP_BAR = TOP_PAD.top + TOP_ROW + TOP_PAD.bottom

/** 两栏：`.deck-body` 的 `gap: 20; padding: 0 30px 24px`，右栏 `--deck-side-w: 496px`。 */
const BODY_PAD_X = 30
const BODY_PAD_BOTTOM = 24
const COLUMN_GAP = 20
const SIDE_WIDTH = 496

/** 卡池筛选栏：`.deck-pool__head` 的 `gap: 14; padding: 18px 22px 14px`，两行。 */
const HEAD_PAD = { top: 18, x: 22, bottom: 14 } as const
const HEAD_ROW_GAP = 14
/** 种类页签那一行和阵营药丸那一行各多高。 */
const KIND_ROW = 30
const FACTION_ROW = 28
const HEAD_HEIGHT = HEAD_PAD.top + KIND_ROW + HEAD_ROW_GAP + FACTION_ROW + HEAD_PAD.bottom

/** 卡池网格：`.deck-grid` 的 `gap: 20px 18px; padding: 20px 22px 24px`，4 列。 */
const GRID_PAD = { top: 20, x: 22, bottom: 24 } as const
const POOL_COLUMNS = 4
const POOL_GAP = { x: 18, y: 20 } as const

/** 牌组栏内边距：`.deck-side__body` 左右各 24。上下取同一个数。 */
const SIDE_PAD = 24
/** 牌组卡位：`.deck-slots` 的 2 列 × 10 行，间距是共用的 `--deck-slot-gap`（10）。 */
const SLOT_COLUMNS = 2
const SLOT_ROWS = 10

/** 牌组栏里几行东西各占多高：页签、管理行、计数、进度条、确认钮。 */
const TABS_HEIGHT = 30
const MANAGE_HEIGHT = 26
const TALLY_HEIGHT = 24
const PROGRESS_HEIGHT = 10
/*
 * 确认钮的高抄对局那颗「结束出牌」的 60（`.battle__end-turn .plaque-button`）。
 * 原先读 `size.plaque.endTurnHeight` 令牌，正式版简化第 5 步撤掉了按钮尺寸那一组；
 * 这一档只有这里在读，所以写在这儿（判据见 design 包的 README）。
 */
const CONFIRM_HEIGHT = 60
/** 牌组栏里上下两行之间留多宽。 */
const ROW_GAP = 10

/**
 * 滚动条的宽，以及它和内容之间留的空。
 *
 * 8px 抄黑客松 `.deck-slots::-webkit-scrollbar` 的宽度。卡池那条摆在网格右侧的内边距里
 *（那边的列宽推导没给滚动条留位置，占了就得重算 249.5）；牌组那条实打实占掉 8px，
 * 和黑客松一样——`--deck-mini-scale` 的公式里预留的就是它。
 */
const BAR_WIDTH = 8
/**
 * 牌组卡位那块地方要从右栏内宽里让出去的总量：滚动条 8 + 两侧余量 16 + 外框描边 2。
 *
 * 那 16 的余量抄黑客松 `--deck-mini-scale` 的推导，它留给两样东西：
 * 格子右上角那颗「－」探出去的一点，以及滚动条两端的装饰。
 * 让出去之后正好剩 422，除以 2 列（含一道 10 的间距）就是那边的 206。
 */
const SLOT_RESERVE = BAR_WIDTH + 16 + 2

/** 一块内容网格：x / y 是滚动量为 0 时第一行的左上角。 */
function contentGrid(
  origin: { x: number; y: number },
  columns: number,
  rows: number,
  cellWidth: number,
  gap: { x: number; y: number },
): GridSpec {
  return {
    x: origin.x,
    y: origin.y,
    columns,
    rows,
    cellWidth,
    cellHeight: (cellWidth * CARD_HEIGHT) / CARD_WIDTH,
    gapX: gap.x,
    gapY: gap.y,
  }
}

/**
 * 这块窗口里同时摆得下几行。
 *
 * 多留一行：滚到一半时上下各露半行，只按整行算的话最下面那一行会缺格子。
 * 这个数就是要建几行格子——滚动时格子原地回收，不跟着内容一起长（见 render.ts）。
 */
function visibleRows(viewHeight: number, cellHeight: number, gapY: number): number {
  return Math.max(1, Math.ceil(viewHeight / (cellHeight + gapY)) + 1)
}

export function desktopLayout(viewWidth: number, viewHeight: number): DeckLayout {
  const width = DESIGN_WIDTH
  const height = DESIGN_HEIGHT
  const scale = Math.min(viewWidth / width, viewHeight / height)

  const bodyY = TOP_BAR
  const bodyHeight = height - bodyY - BODY_PAD_BOTTOM
  const poolWidth = width - BODY_PAD_X * 2 - SIDE_WIDTH - COLUMN_GAP

  const pool: Rect = { x: BODY_PAD_X, y: bodyY, width: poolWidth, height: bodyHeight }
  const poolHead: Rect = { x: pool.x, y: pool.y, width: pool.width, height: HEAD_HEIGHT }
  const poolHint: Rect = {
    x: pool.x,
    y: pool.y + pool.height - HINT_HEIGHT,
    width: pool.width,
    height: HINT_HEIGHT,
  }
  const gridTop = poolHead.y + poolHead.height + GRID_PAD.top
  const poolView: Rect = {
    x: pool.x + GRID_PAD.x,
    y: gridTop,
    width: pool.width - GRID_PAD.x * 2,
    height: poolHint.y - GRID_PAD.bottom - gridTop,
  }
  /*
   * 列宽照黑客松那条推导反算：可用宽减掉三道列间距再除以 4，设计尺寸下正好 249.5
   *（= 150 × 1.6633，也就是 `--deck-pool-scale`）。写成算式而不是写死那个数，
   * 改右栏宽、两栏间距或网格内边距时不用手算。
   */
  const poolCell = (poolView.width - (POOL_COLUMNS - 1) * POOL_GAP.x) / POOL_COLUMNS
  const poolCellHeight = (poolCell * CARD_HEIGHT) / CARD_WIDTH
  const poolGrid = contentGrid(
    poolView,
    POOL_COLUMNS,
    visibleRows(poolView.height, poolCellHeight, POOL_GAP.y),
    poolCell,
    POOL_GAP,
  )

  const side: Rect = {
    x: pool.x + pool.width + COLUMN_GAP,
    y: bodyY,
    width: SIDE_WIDTH,
    height: bodyHeight,
  }
  const rowX = side.x + SIDE_PAD
  const rowWidth = side.width - SIDE_PAD * 2
  const tabs: Rect = { x: rowX, y: side.y + SIDE_PAD, width: rowWidth, height: TABS_HEIGHT }
  const manageY = tabs.y + tabs.height + ROW_GAP
  const tallyY = manageY + MANAGE_HEIGHT + ROW_GAP
  const progress: Rect = {
    x: rowX,
    y: tallyY + TALLY_HEIGHT,
    width: rowWidth,
    height: PROGRESS_HEIGHT,
  }
  const confirmY = side.y + side.height - SIDE_PAD - CONFIRM_HEIGHT
  const sideHint: Rect = {
    x: rowX,
    y: confirmY - ROW_GAP - HINT_HEIGHT,
    width: rowWidth,
    height: HINT_HEIGHT,
  }
  const slotViewY = progress.y + progress.height + ROW_GAP
  const slotView: Rect = {
    x: rowX,
    y: slotViewY,
    // 滚动条实打实占掉 8px，剩下的才是格子的地方（同黑客松）。
    width: rowWidth - SLOT_RESERVE,
    height: Math.max(1, sideHint.y - ROW_GAP - slotViewY),
  }
  /*
   * 格宽同样照黑客松反算：右栏内宽减掉滚动条和一道 gap 再除以 2，
   * 设计尺寸下是 206（= 150 × 1.3733，也就是 `--deck-mini-scale`）。
   */
  const slotCell = (slotView.width - (SLOT_COLUMNS - 1) * SLOT_GAP.x) / SLOT_COLUMNS
  const slots = contentGrid(slotView, SLOT_COLUMNS, SLOT_ROWS, slotCell, SLOT_GAP)

  return {
    tier: 'desktop',
    width,
    height,
    viewport: { width: viewWidth, height: viewHeight },
    stage: { scale, x: (viewWidth - width * scale) / 2, y: (viewHeight - height * scale) / 2 },
    topBarHeight: TOP_BAR,
    back: { x: BODY_PAD_X, y: TOP_PAD.top },
    title: { x: BODY_PAD_X + 120, y: TOP_BAR / 2 },
    pool,
    poolHead,
    poolKinds: { x: poolHead.x + HEAD_PAD.x, y: poolHead.y + HEAD_PAD.top + KIND_ROW / 2 },
    /*
     * 阵营药丸另起一行靠左（黑客松那一档筛选栏就是两行）。
     * 从前桌面档把它挤在种类页签同一行的右端，那是按视口实算时省地方的做法。
     */
    poolFactions: {
      x: poolHead.x + HEAD_PAD.x,
      y: poolHead.y + HEAD_PAD.top + KIND_ROW + HEAD_ROW_GAP + FACTION_ROW / 2,
    },
    poolGrid,
    poolScroll: {
      view: poolView,
      bar: {
        x: poolView.x + poolView.width + (GRID_PAD.x - BAR_WIDTH) / 2,
        y: poolView.y,
        width: BAR_WIDTH,
        height: poolView.height,
      },
    },
    poolHint,
    // 这一档滚动，没有页码这一说。
    pager: null,
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
    slotScroll: {
      view: slotView,
      bar: {
        x: rowX + rowWidth - BAR_WIDTH,
        y: slotView.y,
        width: BAR_WIDTH,
        height: slotView.height,
      },
    },
    sideHint,
    confirm: { x: side.x + side.width / 2, y: confirmY + CONFIRM_HEIGHT / 2 },
    slotCardScale: cardScaleFor(slotCell),
    revealScale: tokens.size.card.revealScale,
  }
}
