/**
 * 首页两档版式。和对局那两档一样，**只输出数、不碰任何 Pixi 对象**，
 * 所以两档几何能在 vitest 里直接断言（按钮不重叠、手机档竖排……），不用起浏览器。
 *
 * 两档的分岔在哪：
 *
 * - **桌面档**：那幅 1672×941 的画按 contain 塞进视口居中，展示卡、桌子、道具
 *   全在画里；标题压在画的上部，「开始游戏」压在画的下部，菜单横着排成一行。
 * - **手机档**：竖屏的短边只有 390，那幅 16:9 的画横着铺满就只有 220 高——
 *   于是画整块**缩到屏幕上半部**，
 *   标题、主按钮和菜单在画的下方**竖着摞**。菜单竖排不是桌面档的缩放，
 *   是另一套摆法：六项横排在 390 宽里挤不下，字再小就点不中了。
 *
 * 画本身两档都用 contain（等比放进给定的那一块），不用 cover：cover 会把画两侧裁掉，
 * 而最外侧那两张展示卡就在那儿。
 */

import { pickTier } from '../duel/layout/pickLayout'
import type { LayoutTier } from '../duel/layout/types'

/** 设计稿那幅画的尺寸，整页的相对坐标都按它算。 */
export const HOME_STAGE = { width: 1672, height: 941 }

/**
 * 四张展示卡在画里的位置（占画宽 / 画高的百分比）和静止倾角，抄旧版 `HomeScreen` 的 SEATS。
 * 注意两端的卡不是抬起而是**沉下去**一点（y 差约 1.6%），弧口朝上。
 */
const SEATS = [
  { x: 36.6, y: 49.7, rotation: -9 },
  { x: 45.5, y: 48.1, rotation: -3 },
  { x: 54.5, y: 48.1, rotation: 3 },
  { x: 63.4, y: 49.7, rotation: 9 },
] as const

/** 展示卡的目标宽度，占画宽的百分之几。改它就等于改整组卡的大小。 */
const CARD_WIDTH_RATIO = 0.11
/** 卡面基准宽（和 `layout/fanMath` 的 CARD_WIDTH 同值）。卡的缩放按它算。 */
const CARD_BASE_WIDTH = 150

/** 桌面档：各块在画里的纵向位置（占画高的百分比）。数值照旧版的排版量出来。 */
const DESKTOP = {
  titleY: 0.155,
  titleSize: 0.052,
  subtitleY: 0.272,
  subtitleSize: 0.021,
  /** 「开始游戏」匾额：宽占画宽的 31.16%（需求单按钮 E），顶边在画高的 74.5% 处。 */
  startWidth: 0.3116,
  startTop: 0.745,
  menuY: 0.9,
  menuSize: 0.0172,
  menuGap: 0.022,
} as const

/** 手机档：画占屏幕上部多少、下面那一摞怎么排。全是占视口的比例。 */
const MOBILE = {
  /** 画最多占视口高的这一成，再宽的屏由 contain 自己收着。 */
  bandHeight: 0.42,
  sideMargin: 0.04,
  titleSize: 0.075,
  subtitleSize: 0.034,
  startWidth: 0.62,
  menuSize: 0.042,
  /** 竖排菜单每一项之间留多少（占视口高）。 */
  menuGap: 0.012,
  gapTitle: 0.02,
  gapStart: 0.028,
  gapMenu: 0.028,
} as const

/** 一块矩形，视口坐标，原点在左上角。 */
export interface HomeRect {
  x: number
  y: number
  width: number
  height: number
}

/** 一张展示卡：卡底中点的位置（CardSprite 的原点约定）、静止倾角、缩放。 */
export interface HomeCardSpot {
  x: number
  y: number
  rotation: number
  scale: number
}

export interface HomeLayout {
  tier: LayoutTier
  width: number
  height: number
  /** 那幅画铺在哪一块（视口坐标）。人物、桌子、道具、展示卡全按它定位。 */
  stage: HomeRect & { scale: number }
  cards: HomeCardSpot[]
  /** 标题和副标题的中心点与字号。 */
  title: { x: number; y: number; fontSize: number }
  subtitle: { x: number; y: number; fontSize: number }
  /** 「开始游戏」匾额的盒子。 */
  start: HomeRect
  /** 菜单每一项的盒子，顺序和调用方给的菜单一致。 */
  menu: HomeRect[]
  /** 菜单项之间那颗分隔星的直径。手机档竖排不摆星，这时是 0。 */
  menuDotSize: number
}

/** 菜单里一项大概多宽：字数 × 字号 ×（1 + 字距），字距按按钮 I 那一档的 0.24em 算。 */
function menuItemWidth(label: string, fontSize: number): number {
  return label.length * fontSize * 1.24
}

/** 把那幅画等比塞进一块矩形并居中（contain）。 */
function fitStage(
  x: number,
  y: number,
  width: number,
  height: number,
): HomeRect & { scale: number } {
  const scale = Math.min(width / HOME_STAGE.width, height / HOME_STAGE.height)
  const stageWidth = HOME_STAGE.width * scale
  const stageHeight = HOME_STAGE.height * scale
  return {
    x: x + (width - stageWidth) / 2,
    y: y + (height - stageHeight) / 2,
    width: stageWidth,
    height: stageHeight,
    scale,
  }
}

/** 四张展示卡：位置按画里的百分比换算，缩放按画宽定。 */
function seatsOf(stage: HomeRect & { scale: number }): HomeCardSpot[] {
  const cardScale = (stage.width * CARD_WIDTH_RATIO) / CARD_BASE_WIDTH
  return SEATS.map((seat) => ({
    x: stage.x + (stage.width * seat.x) / 100,
    // 设计稿量的是卡**中心**，而 CardSprite 的原点在卡底中点，所以要往下落半张卡。
    y: stage.y + (stage.height * seat.y) / 100 + (CARD_BASE_WIDTH * 1.5 * cardScale) / 2,
    rotation: seat.rotation,
    scale: cardScale,
  }))
}

export function pickHomeLayout(
  width: number,
  height: number,
  labels: readonly string[],
  coarsePointer = false,
): HomeLayout {
  return pickTier(width, height, coarsePointer) === 'mobile'
    ? mobileHome(width, height, labels)
    : desktopHome(width, height, labels)
}

function desktopHome(width: number, height: number, labels: readonly string[]): HomeLayout {
  const stage = fitStage(0, 0, width, height)
  const startWidth = stage.width * DESKTOP.startWidth
  // 匾额那张图是 521:125，高按它换算，别把画好的匾额拉变形。
  const startHeight = (startWidth * 125) / 521
  const menuSize = stage.height * DESKTOP.menuSize
  const gap = stage.width * DESKTOP.menuGap
  const widths = labels.map((label) => menuItemWidth(label, menuSize))
  const menuHeight = menuSize * 2.2
  const total = widths.reduce((sum, w) => sum + w, 0) + Math.max(0, labels.length - 1) * gap
  let cursor = stage.x + (stage.width - total) / 2
  const menu = widths.map((itemWidth) => {
    const rect = {
      x: cursor,
      y: stage.y + stage.height * DESKTOP.menuY - menuHeight / 2,
      width: itemWidth,
      height: menuHeight,
    }
    cursor += itemWidth + gap
    return rect
  })

  return {
    tier: 'desktop',
    width,
    height,
    stage,
    cards: seatsOf(stage),
    title: {
      x: stage.x + stage.width / 2,
      y: stage.y + stage.height * DESKTOP.titleY,
      fontSize: stage.height * DESKTOP.titleSize,
    },
    subtitle: {
      x: stage.x + stage.width / 2,
      y: stage.y + stage.height * DESKTOP.subtitleY,
      fontSize: stage.height * DESKTOP.subtitleSize,
    },
    start: {
      x: stage.x + (stage.width - startWidth) / 2,
      y: stage.y + stage.height * DESKTOP.startTop,
      width: startWidth,
      height: startHeight,
    },
    menu,
    menuDotSize: menuSize * 0.55,
  }
}

function mobileHome(width: number, height: number, labels: readonly string[]): HomeLayout {
  const margin = width * MOBILE.sideMargin
  const stage = fitStage(margin, 0, width - margin * 2, height * MOBILE.bandHeight)
  const titleSize = width * MOBILE.titleSize
  const subtitleSize = width * MOBILE.subtitleSize
  const startWidth = width * MOBILE.startWidth
  const startHeight = (startWidth * 125) / 521
  const menuSize = width * MOBILE.menuSize
  const menuHeight = menuSize * 2.4

  // 画的下边缘之下开始往下摞：标题 → 副标题 → 主按钮 → 竖排菜单。
  let y = stage.y + stage.height + height * MOBILE.gapTitle
  const title = { x: width / 2, y: y + titleSize / 2, fontSize: titleSize }
  y += titleSize + height * MOBILE.gapTitle * 0.6
  const subtitle = { x: width / 2, y: y + subtitleSize / 2, fontSize: subtitleSize }
  y += subtitleSize + height * MOBILE.gapStart

  const start = { x: (width - startWidth) / 2, y, width: startWidth, height: startHeight }
  y += startHeight + height * MOBILE.gapMenu

  const menu = labels.map((label) => {
    const itemWidth = menuItemWidth(label, menuSize)
    const rect = { x: (width - itemWidth) / 2, y, width: itemWidth, height: menuHeight }
    y += menuHeight + height * MOBILE.menuGap
    return rect
  })

  return {
    tier: 'mobile',
    width,
    height,
    stage,
    cards: seatsOf(stage),
    title,
    subtitle,
    start,
    menu,
    // 竖排不摆分隔星：那颗星是「项与项之间」的分隔，竖着摆等于在每行之间塞一颗，很吵。
    menuDotSize: 0,
  }
}
