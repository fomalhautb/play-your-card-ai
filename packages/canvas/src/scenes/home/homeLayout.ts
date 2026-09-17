/**
 * 首页版式。**只输出数、不碰任何 Pixi 对象**，所以能在 vitest 里直接断言
 *（整列不重叠、摆得下），端到端用例也靠它算点击落点（见 client 的 e2e/homePage.ts）。
 *
 * 这一页现在只剩一样东西：屏幕正中一列素方块（「开始游戏」加菜单）。
 * 正式版简化第 4 步之前是把 1672×941 那幅画 contain 进视口，之后是「上面一排展示卡
 * 加下面一列方块」；展示卡也删了之后，两档不再有任何差别，所以这里连
 * `pickTier` 那一档判断也去掉了——从前它只管「展示卡放多大」这一件事。
 */

/** 四周留白占视口短边的比例。 */
const MARGIN_RATIO = 0.05

/**
 * 整列至少从这个高度开始，给右上角那颗常驻静音钮让出一条。
 *
 * 那颗钮是 DOM 的、钉在视口右上角（client 的 app/MuteButton.tsx），画布这边量不到它，
 * 所以这个数是照它的尺寸手算的：上边留 8px（muteButton.css）+ 钮高 44px
 *（ui 的 button.css 里方块按钮的 min-height）= 52。
 *
 * 展示卡删掉之后这条还留着，因为它现在管的是另一件事：屏幕矮、菜单项又多时整列会顶到
 * 视口上缘，而列是居中的、在很窄的视口上（宽小于约 210）左右能摸到那颗钮的下缘。
 * 有这条下限，第一行永远在钮下面。
 *
 * 改按钮高度或那 8px 时这个数要跟着改：对不上的那几像素就是点不着的一条。
 * 原来是 44（那时钮还是一行浏览器默认按钮，三十出头），
 * 2026-09-16 按钮统一成方块按钮、高度定到 44 之后抬到 52。
 */
const TOP_RESERVED = 52

/** 一列方块：宽占视口宽几成，以及最窄最宽各多少。 */
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

export interface HomeLayout {
  width: number
  height: number
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
 * 算整页的版式。
 *
 * `labels` 只用来数有几项——方块是定宽的，不像从前那样按字数量宽。
 * 保留这个参数是因为调用方（场景和端到端用例）本来就拿着菜单清单，
 * 换成传个数字反而让「这一项在屏幕的哪儿」多一层换算。
 */
export function pickHomeLayout(
  width: number,
  height: number,
  labels: readonly string[],
): HomeLayout {
  const margin = Math.min(width, height) * MARGIN_RATIO
  const top = Math.max(margin, TOP_RESERVED)
  const rowWidth = clamp(width * COLUMN.widthRatio, COLUMN.minWidth, COLUMN.maxWidth)
  // 整列是「开始游戏」加菜单那几项，一共这么多行。
  const rows = labels.length + 1
  const room = Math.max(0, height - top - margin)
  const rowHeight = clamp((room - ROW_GAP * (rows - 1)) / rows, ROW_HEIGHT.min, ROW_HEIGHT.max)
  const total = rowHeight * rows + ROW_GAP * (rows - 1)
  // 整列在这块地方里居中；摆不下时 total 比 room 大，这一项夹回 0 就贴着上边缘摆。
  let y = top + Math.max(0, (room - total) / 2)
  const x = (width - rowWidth) / 2

  const start = { x, y, width: rowWidth, height: rowHeight }
  y += rowHeight + ROW_GAP
  const menu = labels.map(() => {
    const rect = { x, y, width: rowWidth, height: rowHeight }
    y += rowHeight + ROW_GAP
    return rect
  })

  return { width, height, start, menu }
}
