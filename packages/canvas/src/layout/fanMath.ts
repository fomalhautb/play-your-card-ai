/**
 * 扇形手牌的布局数学。数值和公式抄自旧客户端 `src/ui/fanMath.ts`，实现改成不依赖 DOM。
 *
 * 坐标系约定（和旧版一致，Pixi 这边照搬）：
 * 原点在扇形锚点容器的底边中点，y 向下为正，每张牌以自己的**底边中点**为旋转和缩放的轴。
 * 对手扇形不改这套数学，而是把整个锚点容器转 180° 吊到视口顶边，
 * 于是"往下沉"自动变成"往上沉"、"两端向下垂"自动变成"两端向上垂"。
 *
 * 这些常量为什么留在组件里而不进 `@ai-duel/design`：它们是手牌扇形自己的几何，
 * 别的组件不会用到，而且改一个就要重新验算 hover 防抖动的下限（见 handLayout.ts 的
 * MIN_HOVER_SCALE）。设计令牌收的是跨组件共用的那批值——卡面尺寸和重排时长就来自那边。
 */

import { tokens } from '@ai-duel/design'

/** 卡面基准尺寸。和令牌同一份数（旧版是 styles.css 的 --card-w / --card-h）。 */
export const CARD_WIDTH = tokens.size.card.width
export const CARD_HEIGHT = tokens.size.card.height

/**
 * 卡面圆角，按卡面基准宽配的（黑客松版 styles.css 里 `.card-face` 的 8px）。
 *
 * 一度写成 10——那是从 `ui/paper/paper.css` 的 `.paper-card` 抄来的，
 * 而那条是纸面组件的圆角，不是卡面的。正式版简化第 4 步之三改回 8。
 *
 * 画到卡角的几处必须都用它，缺一处卡角就对不齐：原画和牌背的圆角在构建期烤进图集的 alpha
 * （assets/build-atlas.mjs 按同一个令牌等比放大到 512 那一档），代码画的边框羽化带和
 * 对手牌背见 fx/cardShapes.ts，跟着指针跑的反光在着色器里做圆角裁剪见 fx/cardGlare.ts，
 * 落地那圈亮环的圆角轮廓见 fx/edgeRing.ts。
 */
export const CARD_RADIUS = tokens.size.card.radius

/**
 * 手牌张开的总角度，几张牌都是这个数。
 *
 * 固定不变是刻意的：早先是"每多一张多张开 5°、封顶 40°"，出一张牌整排就重新拱一次，
 * 明明只少了一张牌，看上去却像整只手换了个握法。固定下来之后加减牌只改牌与牌的间距，
 * 两端永远是 ±SPREAD_DEG/2 = 20°，hover 防抖动的几何下限才有一个恒定的最大倾角可算。
 */
export const SPREAD_DEG = 40
/** 每张牌理想的水平间距；卡宽 150，所以到这个间距时相邻卡已经互相压住一部分。 */
export const GAP_PER_CARD = 95
/** 手牌总宽上限，超过就压缩间距让牌重叠。 */
export const MAX_SPAN = 900
/** 扇形最外侧那张牌和可用区域边缘之间至少留出的空隙，纯观感。 */
export const EDGE_MARGIN = 16
/** 重排（加牌 / 减牌 / 改视口大小）的时长，两侧手牌共用。 */
export const LAYOUT_DUR = tokens.duration.hand.layout

/** 一副扇形手牌的两个可调参数，其余公式两边完全共用。 */
export interface FanGeometry {
  /**
   * 卡牌沉出锚点边缘多少像素：越大，露在外面的部分越少。
   * 取 0 就是卡的底边正好压在锚点边缘上；取负值则整张牌往锚点内侧挪，露得更多。
   */
  sink: number
  /**
   * 扇形下垂用的虚拟半径。
   *
   * 下垂量是 arcRadius × (1 − cos 倾角)，所以半径越大、同样的倾角垂得越多。
   * 想把弧线压平要**调小**它，不是调大——这一点很容易记反。
   */
  arcRadius: number
}

/**
 * 玩家手牌：整排抬进视口 32px，沉出屏幕的只有两端那两个角。
 *
 * sink 取负是因为卡面最下面那块名字铭牌紧贴卡的底边，整张牌往下沉一点就被视口切掉，
 * 而铭牌上的名字必须看清。32 是旧版在 1280×800 下量出来的"尽量沉、又不切字"的那个点：
 * 两端下垂 24px，牌又以底边中点为轴转了 20°、最低那个角还要再往下探
 * (卡宽/2)·sin20° ≈ 26px，最外侧那两个角因此落在视口下方约 18px 处。
 */
export const PLAYER_FAN: FanGeometry = {
  sink: -32,
  arcRadius: 400,
}

/**
 * 对手手牌：倒挂在视口顶边，整排还按 0.64 缩了一号（缩放不在这套数学里，见 HandFan）。
 *
 * sink 归 0 是按"每张牌在顶栏下方还能露出多少"倒推的：缩放的轴是卡的底边中点，
 * 而 sink 和下垂量是父坐标系里的位移、不跟着卡一起缩，所以
 * 露出高度 = 卡高 225 × 0.64 − sink − 下垂量 − 顶栏高。缩到 0.64 之后卡只剩 144 高，
 * 再照旧沉 8px 就只露五十来像素，一排牌看着像一条边框。
 * arcRadius 260 挑的是"两端还能露出多少"（垂 16px 时露 56px），和玩家那档的 400
 * 各按各的理由选，改一边不用跟着改另一边。
 */
export const OPPONENT_FAN: FanGeometry = {
  sink: 0,
  arcRadius: 260,
}

export interface SlotTransform {
  /** 相对锚点原点的横向位移。 */
  x: number
  /** 相对锚点原点的纵向位移，向下为正。 */
  y: number
  /** 旋转角度，单位是**度**（Pixi 用弧度，写进显示对象前要换算）。 */
  rotation: number
}

/**
 * 一张倾斜 θ 的牌横向要伸出多远（以底边中点为轴）。
 *
 * 不是半个卡宽：上面那个角被转出去了，实际占位是
 * (卡宽/2)·cos θ + 卡高·sin θ——20° 时是 142px，比半个卡宽 75px 多出快一倍。
 * 扇形铺多宽和 hover 放大的下限都要用它。
 */
export function tiltHalfExtent(tiltDeg: number): number {
  const tilt = (tiltDeg * Math.PI) / 180
  return (CARD_WIDTH / 2) * Math.cos(tilt) + CARD_HEIGHT * Math.sin(tilt)
}

/**
 * 算出第 index 张牌在扇形里的基准位置。
 *
 * areaWidth 是"这排扇形可以铺开多宽"，不是视口宽：旧版里两排都以战场那一栏为地盘，
 * 玩家手牌还要再让开右下角那颗结束按钮。这里由调用方算好传进来。
 *
 * 以底边中点为旋转轴是防抖动的第一步：hover 时只放大、只往上长，绝不往下移，
 * 卡底始终不会往锚点内侧跑。第二步是放大倍数的下限，见 handLayout.ts 的 MIN_HOVER_SCALE。
 */
export function fanTransform(
  index: number,
  count: number,
  areaWidth: number,
  geometry: FanGeometry,
): SlotTransform {
  if (count <= 1) return { x: 0, y: geometry.sink, rotation: 0 }

  const rotation = -SPREAD_DEG / 2 + (SPREAD_DEG / (count - 1)) * index

  /*
   * 能张多宽由三条一起卡：理想间距、总宽上限，以及"最外侧那张牌不许越过可用区域的边"。
   * 第三条按倾斜后的实际占位算（tiltHalfExtent），不能拿卡宽了事。
   *
   * span 是"每张牌摊一格"的总宽，最外侧牌心只到 span/2 × (count−1)/count，
   * 所以反推可用的 span 时要再乘回 count/(count−1)。
   */
  const fitHalf = Math.max(0, areaWidth / 2 - EDGE_MARGIN - tiltHalfExtent(SPREAD_DEG / 2))
  const fitSpan = (fitHalf * 2 * count) / (count - 1)

  const span = Math.min(fitSpan, MAX_SPAN, count * GAP_PER_CARD)
  const gap = span / count
  const x = (index - (count - 1) / 2) * gap

  // 让扇形的两端往下垂，像一叠握在手里的牌，而不是排在一条直线上。
  const droop = geometry.arcRadius * (1 - Math.cos((rotation * Math.PI) / 180))
  return { x, y: geometry.sink + droop, rotation }
}
