/**
 * 构筑页零件表的**形状和尺寸**：有哪些零件、它们各占多大。
 *
 * 单独一个文件是因为建零件（parts.ts）和摆零件（partsLayout.ts）都要认它，
 * 而那两边谁都不该去 import 对方（400 行那条上限把它们拆开的，见架构 7.2 第 3 条）。
 * 这里一行逻辑都没有，全是类型和数。
 */

import type { Container, Graphics } from 'pixi.js'
import type { Box } from '../../components/Box'
import type { DeckSlots } from '../../components/DeckSlots'
import type { PoolCell } from '../../components/PoolCell'
import type { RevealOverlay } from '../../components/RevealOverlay'
import type { BoxTabs } from './boxTabs'
import type { ScrollBar } from './scrollBar'

/** 页头标题。写死在这里而不是由调用方给：这一页只有这一个身份。 */
export const TITLE = '组建牌组'
/** 返回钮和标题各占多大，以及两者之间留多宽。摆位置那一半在 partsLayout.ts，所以导出。 */
export const BACK = { width: 88, height: 34 } as const
export const TITLE_BOX = { width: 160, height: 34 } as const
export const TITLE_GAP = 20

/** 牌组栏里那几颗小钮的宽。高由版式那几行给。 */
export const MANAGE_WIDTH = 76
export const NEW_DECK_WIDTH = 92
export const DRAWER_WIDTH = 72
/** 翻页那两颗钮的宽（只有手机档有翻页）。 */
export const PAGER_BUTTON = { width: 72, height: 28 } as const

/** 「加不进去」那句浮字的尺寸。宽度按最长那句（「同一张牌最多带 3 份」）给够。 */
export const TIP = { width: 200, height: 26 } as const

/** 放大查看时底下那行操作钮的尺寸，以及它离卡底多远。 */
export const ZOOM_ACTION = { width: 120, height: 36, gap: 20, top: 26 } as const

/**
 * 正面大卡、背面大卡停在舞台横向的哪一处，以及两张共用的纵向位置。
 *
 * 抄黑客松 `.deck-page .reveal-card` 的 `left: 39%` 和 `.deck-zoom-side__card` 的
 * `left: 61%; top: 46%`：卡宽 255（150 × 1.7），两张之间留 110 左右的过道，
 * 于是各距舞台中线约 11%。改放大倍数时这两个数要一起重算。
 */
export const ZOOM_FRONT_X = 0.39
export const ZOOM_BACK_X = 0.61
export const ZOOM_ANCHOR_Y = 0.46

export interface DeckLayers {
  pool: Container
  poolCards: Container
  side: Container
  drag: Container
  overlay: Container
}

export interface DeckParts {
  layers: DeckLayers
  back: Box
  title: Box
  /** 卡池外框。 */
  pool: Box
  /** 种类页签（标签页 B）和阵营药丸（标签页 C）。 */
  kindTabs: BoxTabs
  factionTabs: BoxTabs
  /**
   * 卡池那一屏的格子。**长住**——滚动只换里面那张卡和它的落点，格子本身一次都不重建。
   * 它的长度是这一档版式**同时摆得下**几格（桌面 4 × 露头那一行，手机一页 6 格）。
   */
  poolCells: PoolCell[]
  /** 卡池滚动那一刀。不滚动的那一档（手机）是 null。 */
  poolClip: Graphics | null
  poolBar: ScrollBar | null
  poolHint: Box
  /** 翻页控件。滚动那一档（桌面）是 null。 */
  pager: { prev: Box; next: Box; label: Box } | null
  /** 牌组栏外框。 */
  side: Box
  /** 牌组页签（标签页 A）和末尾那颗「新建」。 */
  deckTabs: BoxTabs
  newDeck: Box
  /**
   * 手机档抽屉的把手。桌面档也建但**藏着**——两档的零件表保持一样，
   * 省掉一路 `null` 判断；藏起来的那颗一次都不会被点到。
   */
  drawerHandle: Box
  rename: Box
  remove: Box
  tally: Box
  /** 进度条：外框一块、里面按比例撑开一块。 */
  progress: { track: Box; fill: Box }
  slots: DeckSlots
  slotBar: ScrollBar | null
  sideHint: Box
  confirm: Box
  reveal: RevealOverlay
  /** 「这张加不进去」那句浮字。长住、平时藏着（见 refuse.ts）。 */
  tip: Box
  /** 放大查看时右边那张背面大卡挂在这一层，整层由 inspect 淡入淡出。 */
  zoomSide: Container
  /** 大卡底下那一行操作钮。 */
  zoomActions: { add: Box; close: Box }
}
