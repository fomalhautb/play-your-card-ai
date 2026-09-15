/**
 * 两档牌组编辑版式共用的形状、常量和几何算法。
 *
 * 需求第 3 条：手机小屏和电脑大屏是**并列**的两档版式，不是把桌面版整体缩放。
 * 所以这里只定「两档都要回答哪些问题」，各自的答案分别写在 desktopLayout.ts 和
 * mobileLayout.ts 里。两档真正分岔的地方有三处：卡池网格的列数、牌组栏是竖着一整条
 * 还是折叠成底部抽屉、以及卡缩到多大。
 *
 * 版式只输出**数**，不碰任何 Pixi 对象：两档的几何因此能在 vitest 里直接断言
 *（卡池不和牌组栏重叠、抽屉收起来时不挡住卡池……），不用起浏览器。
 *
 * ## 坐标基准
 *
 * `width` / `height` 和下面每一个矩形都是**舞台坐标**。桌面档的舞台是 1672×941 的死版式，
 * 真实视口和换算写在 `viewport` / `stage` 两项里，由场景写到根节点的 scale 和 position 上
 *（同对局场景，见 scenes/duel/layout/types.ts）。手机档不缩放：`stage.scale` 为 1、偏移为 0，
 * 于是舞台坐标就是视口坐标，两档共用同一套下游代码。
 *
 * ## 两档的卡池不是同一种翻法
 *
 * 桌面档**纵向滚动**（`poolScroll` / `slotScroll` 不为 null），手机档**翻页**（`pager` 不为 null）。
 * 两组字段互斥：是谁由档位定死，不存在两样都开着的版式。滚动那一档的网格是**内容网格**——
 * `rows` 只说「窗口里同时摆得下几行」，真正有几行跟着卡池张数走，由场景在 render 时算。
 */

import { tokens } from '@ai-duel/design'
import { CARD_HEIGHT, CARD_WIDTH } from '../../../layout/fanMath'
import type { GridSpec } from '../../../layout/gridMath'

/** 两档版式。名字按屏幕形态取，不按设备品类——平板横屏走桌面档。 */
export type DeckLayoutTier = 'desktop' | 'mobile'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 一块纵向滚动区：可视窗口加一条滚动条。
 *
 * 窗口就是遮罩那块矩形；内容比它高多少由场景按实际张数算（版式不知道卡池有几张）。
 * 滚动条摆在窗口右边的内边距里，不占内容宽——占了的话格宽的那条推导就要跟着改。
 */
interface ScrollSpec {
  /** 可视窗口。遮罩画的就是它，命中判定也按它。 */
  view: Rect
  /** 滚动条的轨。滑块由场景按「看到了内容的哪一段」在轨里定位。 */
  bar: Rect
}

/**
 * 牌组栏在手机档折叠成的抽屉。
 *
 * 只有**一块**面板：收起来不是换一块小的，而是把整层往下挪 `DeckLayout.drawerOffset`，
 * 于是最上面那一条（把手 + 计数 + 进度条）正好停在屏幕底边上。
 */
interface DrawerSpec {
  /** 收起来时露在外面那一条。 */
  collapsed: Rect
  /** 展开之后整块。和 `DeckLayout.side` 是同一块。 */
  expanded: Rect
  /** 把手那颗钮的左上角（在展开的坐标里）。 */
  handle: { x: number; y: number }
}

export interface DeckLayout {
  tier: DeckLayoutTier
  /** 舞台宽高。桌面档恒为 1672×941，手机档就是视口。 */
  width: number
  height: number
  /** 真实视口。只有画舞台四周那一圈挡边时用得着。 */
  viewport: { width: number; height: number }
  /** 舞台整块怎么放进视口：等比缩放 + 居中偏移。手机档是 `{ scale: 1, x: 0, y: 0 }`。 */
  stage: { scale: number; x: number; y: number }
  /** 顶栏压在视口顶边，整条通宽。 */
  topBarHeight: number
  /** 返回钮的左上角。 */
  back: { x: number; y: number }
  /** 页头标题的锚点（居左）。 */
  title: { x: number; y: number }

  /** 卡池底板（面板 D）。 */
  pool: Rect
  /** 卡池头部那一条。手机档它有两行高（种类页签一行、阵营药丸一行）。 */
  poolHead: Rect
  /** 种类页签（标签页 B）的左上角。 */
  poolKinds: { x: number; y: number }
  /**
   * 阵营药丸（标签页 C）那一排摆哪儿。
   *
   * 两档都是**另起一行靠左**：桌面档回到黑客松那一版之后筛选栏就是两行
   *（种类页签一行、阵营药丸一行），手机档本来就是两行。
   */
  poolFactions: { x: number; y: number }
  /**
   * 卡池网格。
   *
   * 翻页那一档（手机）它就是一页；滚动那一档（桌面）它是**内容网格**：
   * x / y 是滚动量为 0 时第一行的左上角，`rows` 只说窗口里同时摆得下几行
   *（含露头那一行），真正有几行跟着筛完的张数走。
   */
  poolGrid: GridSpec
  /** 卡池纵向滚动。翻页那一档是 null。 */
  poolScroll: ScrollSpec | null
  /** 卡池底边那条提示（提示 A）。 */
  poolHint: Rect
  /** 翻页控件：两颗钮的左上角和中间那行页码的锚点。滚动那一档是 null。 */
  pager: {
    prev: { x: number; y: number }
    next: { x: number; y: number }
    label: { x: number; y: number }
  } | null
  /** 卡池里一张卡缩到多大（基准是 150×225）。 */
  poolCardScale: number

  /**
   * 牌组栏。桌面档是右边竖着一整条；手机档它是抽屉展开之后那一块，
   * 收起来时长什么样看 `drawer`。
   */
  side: Rect
  /** 手机档才有的抽屉。桌面档为 null——那一档牌组栏一直摊着，没有收起这一说。 */
  drawer: DrawerSpec | null
  /**
   * 抽屉收起来时整层往下挪多少。桌面档恒为 0。
   *
   * 开关抽屉只写这一个 y，一块底板都不用重画（3.10）。
   */
  drawerOffset: number
  /** 牌组页签那一行（标签页 A）。 */
  tabs: Rect
  /** 「改名 / 删除」那一行的左上角。 */
  manage: { x: number; y: number }
  /** 「已选 N / 20」的锚点（居左）。 */
  tally: { x: number; y: number }
  /** 进度条（条 A）。 */
  progress: Rect
  /** 牌组那 20 个卡位。滚动那一档它同样是内容网格，窗口见 `slotScroll`。 */
  slots: GridSpec
  /** 牌组卡位的纵向滚动。一屏摆得下的那一档（手机）是 null。 */
  slotScroll: ScrollSpec | null
  /** 牌组栏底边那条提示。 */
  sideHint: Rect
  /** 「确认牌组」按钮的中心。 */
  confirm: { x: number; y: number }
  /** 卡位里一张卡缩到多大。 */
  slotCardScale: number
  /** 放大查看时卡在屏幕中央放到多大。触屏档更大，见 `size.card.revealScaleTouch`。 */
  revealScale: number
}

/**
 * 网格里相邻两格的空隙。
 *
 * 卡池那一组只有手机档在用（桌面档回到黑客松 `.deck-grid` 的 18 / 20，写在它自己那边）；
 * 卡位那一组两档同用，就是黑客松 `--deck-slot-gap` 的 10。
 */
export const POOL_GAP = { x: 16, y: 16 }
export const SLOT_GAP = { x: 10, y: 10 }
/** 卡池头部条、底部提示条的高。抄旧版 `.deck-pool__head` 和 `.deck-pool__hint`。 */
export const POOL_HEAD_HEIGHT = 44
export const HINT_HEIGHT = 32
/** 翻页那一行的高。 */
export const PAGER_HEIGHT = 36

/** 夹在上下限之间。两档版式都要用，写一遍。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 一块地方里塞得下多大的格子：宽高两边各算一次，取小的那个。
 *
 * 格子恒是 2:3（卡面的比例），所以只算宽、高按比例推。
 * 不封顶到 1：构筑页的卡本来就画得比对局里大（旧版卡池那张是 1.66 倍），
 * 大屏上让它继续长是对的——那一屏就这么点东西，留白反而空。
 */
export function fitCellWidth(
  available: { width: number; height: number },
  grid: { columns: number; rows: number; gapX: number; gapY: number },
): number {
  const byWidth = (available.width - (grid.columns - 1) * grid.gapX) / grid.columns
  const byHeight =
    ((available.height - (grid.rows - 1) * grid.gapY) / grid.rows) * (CARD_WIDTH / CARD_HEIGHT)
  return Math.max(1, Math.min(byWidth, byHeight))
}

/** 按格宽把一块网格摆到 `area` 的左上角，并让整块在 `area` 里居中。 */
export function centeredGrid(
  area: Rect,
  shape: { columns: number; rows: number; gapX: number; gapY: number },
  cellWidth: number,
): GridSpec {
  const cellHeight = (cellWidth * CARD_HEIGHT) / CARD_WIDTH
  const width = shape.columns * cellWidth + (shape.columns - 1) * shape.gapX
  const height = shape.rows * cellHeight + (shape.rows - 1) * shape.gapY
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    columns: shape.columns,
    rows: shape.rows,
    cellWidth,
    cellHeight,
    gapX: shape.gapX,
    gapY: shape.gapY,
  }
}

/** 一张卡（基准 150×225）画进这么宽的格子要缩多少。 */
export function cardScaleFor(cellWidth: number): number {
  return cellWidth / CARD_WIDTH
}

/**
 * 手机档顶栏高。
 *
 * 桌面档不在这里：那一档的顶栏是按黑客松 `.deck-top` 的 padding 16/30/12 现推的，
 * 只有它自己用得着（见 desktopLayout.ts）。
 */
export const MOBILE_TOP_BAR = tokens.size.battle.topbarHeightTouch
