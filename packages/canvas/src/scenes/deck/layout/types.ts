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
  width: number
  height: number
  /** 顶栏压在视口顶边，整条通宽。 */
  topBarHeight: number
  /** 返回钮的左上角。 */
  back: { x: number; y: number }
  /** 页头标题的锚点（居左）。 */
  title: { x: number; y: number }

  /** 卡池底板（面板 D）。 */
  pool: Rect
  /** 卡池头部那一条：种类页签在左，阵营药丸在右。 */
  poolHead: Rect
  /** 卡池网格。列数两档不同。 */
  poolGrid: GridSpec
  /** 卡池底边那条提示（提示 A）。 */
  poolHint: Rect
  /** 翻页控件：两颗钮的左上角和中间那行页码的锚点。 */
  pager: {
    prev: { x: number; y: number }
    next: { x: number; y: number }
    label: { x: number; y: number }
  }
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
  /** 牌组那 20 个卡位。 */
  slots: GridSpec
  /** 牌组栏底边那条提示。 */
  sideHint: Rect
  /** 「确认牌组」按钮的中心。 */
  confirm: { x: number; y: number }
  /** 卡位里一张卡缩到多大。 */
  slotCardScale: number
  /** 放大查看时卡在屏幕中央放到多大。触屏档更大，见 `size.card.revealScaleTouch`。 */
  revealScale: number
}

/** 整页四周留多宽。两档各有各的值，这里只给桌面档那一档当默认。 */
export const PAGE_PAD = 24
/** 网格里相邻两格的空隙。抄旧样式 `.deck-grid` 的 18 / 20 和 `.deck-slots` 的 10。 */
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

/** 桌面档顶栏高。和对局那一档同一个令牌——两页的顶栏本来就是同一条。 */
export const DESKTOP_TOP_BAR = tokens.size.battle.topbarHeight
/** 手机档顶栏高。 */
export const MOBILE_TOP_BAR = tokens.size.battle.topbarHeightTouch
