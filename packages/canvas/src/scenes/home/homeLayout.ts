/**
 * 首页版式。**只输出数、不碰任何 Pixi 对象**，所以能在 vitest 里直接断言
 *（方块不重叠、整列摆得下），端到端用例也靠它算点击落点（见 client 的 e2e/homePage.ts）。
 *
 * 正式版简化第 4 步之前这里是两套摆法（桌面档把 1672×941 那幅画 contain 进视口、
 * 菜单横排；手机档把画缩到上半屏、下面竖着摞）。那幅画连同它的四层底图一起删了，
 * 现在**两档共用同一套算法**：上面一排展示卡，下面一列素方块，全部按视口现算。
 *
 * `pickTier` 仍然在用，但只剩一件事：决定展示卡放多大。手机档屏窄，
 * 卡按桌面档那个比例摆四张会挤成一条缝。
 */

import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import { pickTier } from '../duel/layout/pickLayout'
import type { LayoutTier } from '../duel/layout/types'

/** 展示卡占视口高的几成（两档各一个数，这是 tier 唯一还管的事）。 */
const CARD_HEIGHT_RATIO = { desktop: 0.26, mobile: 0.18 }

/** 四张展示卡的静止倾角和下沉量（占卡高的百分比），弧口朝上。抄的是旧版那道弧。 */
const SEATS = [
  { rotation: -9, sag: 0.016 },
  { rotation: -3, sag: 0 },
  { rotation: 3, sag: 0 },
  { rotation: 9, sag: 0.016 },
] as const

/** 相邻两张卡的中心间距，按卡宽的倍数。小于 1 就是互相压着，正好是扇面的样子。 */
const CARD_PITCH = 0.92

/** 四周留白占视口短边的比例。 */
const MARGIN_RATIO = 0.05

/**
 * 最上面那一排展示卡至少从这个高度开始，给右上角那颗常驻静音钮让出一条。
 *
 * 那颗钮是 DOM 的、钉在视口右上角（client 的 app/MuteButton.tsx），画布这边量不到它，
 * 所以这个数是照它的尺寸手算的：上边留 8px（muteButton.css）+ 钮高 44px
 *（ui 的 button.css 里方块按钮的 min-height）= 52。窄屏上四张卡是按宽度铺满的，
 * 最右那张正好顶到右上角被它压住——实测 375×812 下就是这样。
 * 宽屏的留白本来就比这条宽，这个数在那儿不起作用。
 *
 * 改按钮高度或那 8px 时这个数要跟着改：对不上的那几像素就是点不着的一条。
 * 原来是 44（那时钮还是一行浏览器默认按钮，三十出头），
 * 2026-09-16 按钮统一成方块按钮、高度定到 44 之后抬到 52。
 */
const TOP_RESERVED = 52

/** 展示卡那一条占视口高的几成。下面那一列从它的下边缘开始摆。 */
const CARD_BAND_RATIO = 0.3

/** 下面那一列：方块宽占视口宽几成，以及最窄最宽各多少。 */
const COLUMN = { widthRatio: 0.5, minWidth: 160, maxWidth: 320 }

/** 行高的上下限和行距。项数多、屏幕矮时行高会一路压到下限。 */
const ROW_HEIGHT = { min: 24, max: 48 }
const ROW_GAP = 10

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
  cards: HomeCardSpot[]
  /** 「开始游戏」那一块，摆在整列最上面。 */
  start: HomeRect
  /** 菜单每一项的盒子，顺序和调用方给的菜单一致。 */
  menu: HomeRect[]
}

/** 夹在上下限之间。 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 四张展示卡摆成一排。
 *
 * 卡的缩放先按视口高定，再看横向摆不摆得下——窄屏上四张卡一字排开会顶出屏幕，
 * 这时按宽度再收一次。
 */
function seatsOf(width: number, height: number, tier: LayoutTier, top: number): HomeCardSpot[] {
  const margin = Math.min(width, height) * MARGIN_RATIO
  const byHeight = (height * CARD_HEIGHT_RATIO[tier]) / CARD_HEIGHT
  const spread = CARD_WIDTH * CARD_PITCH * (SEATS.length - 1) + CARD_WIDTH
  const byWidth = (width - margin * 2) / spread
  const scale = Math.min(byHeight, byWidth)
  const pitch = CARD_WIDTH * CARD_PITCH * scale
  const cardHeight = CARD_HEIGHT * scale
  const first = width / 2 - (pitch * (SEATS.length - 1)) / 2
  return SEATS.map((seat, index) => ({
    x: first + pitch * index,
    // 原点在卡底中点，所以这一排的「顶边」要加一整张卡高才是落点。
    y: top + cardHeight * (1 + seat.sag),
    rotation: seat.rotation,
    scale,
  }))
}

/**
 * 算一档版式。
 *
 * `labels` 只用来数有几项——方块是定宽的，不像从前那样按字数量宽。
 * 保留这个参数是因为调用方（场景和端到端用例）本来就拿着菜单清单，
 * 换成传个数字反而让「这一项在屏幕的哪儿」多一层换算。
 */
export function pickHomeLayout(
  width: number,
  height: number,
  labels: readonly string[],
  coarsePointer = false,
): HomeLayout {
  const tier = pickTier(width, height, coarsePointer)
  const margin = Math.min(width, height) * MARGIN_RATIO
  const cards = seatsOf(width, height, tier, Math.max(margin, TOP_RESERVED))

  const bandBottom = margin + height * CARD_BAND_RATIO
  const rowWidth = clamp(width * COLUMN.widthRatio, COLUMN.minWidth, COLUMN.maxWidth)
  // 整列是「开始游戏」加菜单那几项，一共这么多行。
  const rows = labels.length + 1
  const room = Math.max(0, height - bandBottom - margin)
  const rowHeight = clamp((room - ROW_GAP * (rows - 1)) / rows, ROW_HEIGHT.min, ROW_HEIGHT.max)
  const total = rowHeight * rows + ROW_GAP * (rows - 1)
  // 整列在剩下这块地方里再居中一次；摆不下时 total 比 room 大，这一项夹回 0 就贴着上边缘摆。
  let y = bandBottom + Math.max(0, (room - total) / 2)
  const x = (width - rowWidth) / 2

  const start = { x, y, width: rowWidth, height: rowHeight }
  y += rowHeight + ROW_GAP
  const menu = labels.map(() => {
    const rect = { x, y, width: rowWidth, height: rowHeight }
    y += rowHeight + ROW_GAP
    return rect
  })

  return { tier, width, height, cards, start, menu }
}
