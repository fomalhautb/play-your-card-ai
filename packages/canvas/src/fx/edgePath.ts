/**
 * 落地追光绕着卡跑的那条**圆角矩形**路径。
 *
 * 单开一个文件而不是塞在 HitFx.ts 里：这里是一份不碰 Pixi 的纯几何，
 * 和 layout/fanMath.ts、interaction/dragRules.ts 一样——纯的那一半单测能覆盖，
 * 带显示对象的那一半（精灵、补间）归截图回归管（6.6）。
 *
 * 为什么非要走圆角：卡面是圆角的（原画的圆角在构建期烤进图集 alpha，代码画的边框见
 * bakedTextures.ts），追光以前沿的是直角矩形，四个转角上光点会探到卡的圆角外面去，
 * 一眼就看得出来。旧客户端那圈追光是 conic-gradient 加圆角 mask 裁出来的
 *（legacy-client/src/styles.css 的 .battle__tile-edge-ring），路径天生跟着 border-radius，
 * 换到 Pixi 之后得自己把这条路走出来。
 *
 * 按**弧长**参数化，不是按圆心角：光点要匀速跑完一圈。
 * 按圆心角均分的话，同样的一份时间在转角上只走 r 那么一小段、在直边上要走几十像素，
 * 看着就是"到角上突然卡一下"。
 */

import { CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'

/** 追光走到某一处时的落点和朝向。写进调用方给的对象里，不新建（3.10）。 */
export interface EdgePoint {
  x: number
  y: number
  /** 该处的切线方向（弧度）。沿路单调从 0 涨到 2π，转角处不再跳变。 */
  angle: number
}

/**
 * 追光要跑的那条圆角矩形，一次落地算一遍，之后每帧只做标量算术。
 *
 * 存的是长度而不是四个角的坐标：光点的位置是按**弧长**参数化的
 *（走过多少距离，而不是转过多少角度），所以每帧要问的一直是"这段有多长"。
 */
export interface EdgePath {
  halfW: number
  halfH: number
  /** 圆角半径。 */
  radius: number
  /** 上、下两条直边各自的长度（w − 2r）。 */
  straightH: number
  /** 左、右两条直边各自的长度（h − 2r）。 */
  straightV: number
  /** 一个圆角的弧长（πr/2）。四个角合起来正好是一个整圆，2πr。 */
  arc: number
  /** 跑满一圈的总长：四条直边加四段弧 = 2(w + h) − 8r + 2πr。 */
  perimeter: number
  /** 起跑点离"上边直边左端"多远。取半条上直边，一圈就从卡的正上方开始和结束。 */
  start: number
}

const HALF_PI = Math.PI / 2

/**
 * 按一张宽 w 高 h 的卡算出追光的路径，结果写进 path。
 *
 * 圆角**不是**独立配的：卡面原画、代码画的边框、这条追光必须是同一个轮廓，
 * 差一点点就会在转角处露馅。所以半径由令牌的 CARD_RADIUS 按 w / CARD_WIDTH 等比缩放
 *（两个调用方传的 width 都是 CARD_WIDTH × 某个缩放，见 duelPrototype 和 HitFx.stories）。
 * 再按 min(w, h) / 2 兜一次底：半径大过短边的一半时圆角矩形就退化成胶囊，
 * 直边长度会算成负数。
 */
export function setEdgePath(path: EdgePath, w: number, h: number): void {
  const radius = Math.min((CARD_RADIUS * w) / CARD_WIDTH, Math.min(w, h) / 2)
  path.halfW = w / 2
  path.halfH = h / 2
  path.radius = radius
  path.straightH = w - 2 * radius
  path.straightV = h - 2 * radius
  path.arc = HALF_PI * radius
  path.perimeter = 2 * (path.straightH + path.straightV) + 2 * Math.PI * radius
  path.start = path.straightH / 2
}

/**
 * 沿圆角矩形走到 t（0~1）处的位置和切线方向，写进 out。
 *
 * 起点在上边中点，顺时针走（y 向下的坐标系里，顺时针就是"先往右"）。
 * 八段依次是：上直边 → 右上角 → 右直边 → 右下角 → 下直边 → 左下角 → 左直边 → 左上角。
 * 匀速跑的是**弧长**，所以光点在转角不会突然加速——按圆心角均分的话，
 * 同样的一份时间在角上只走 r 那么一小段，直边上却要走几十像素。
 *
 * 半径取 0 时四段弧长度都是 0，判断全部落空，退化成原来的直角矩形。
 */
export function edgePointAt(path: EdgePath, t: number, out: EdgePoint): void {
  const { halfW, halfH, radius: r, straightH, straightV, arc } = path
  // 先把 t 折回 [0, 1)，负数和大于 1 的都能用。
  const wrapped = ((t % 1) + 1) % 1
  let p = (wrapped * path.perimeter + path.start) % path.perimeter

  if (p < straightH) {
    out.x = -halfW + r + p
    out.y = -halfH
    out.angle = 0
    return
  }
  p -= straightH
  if (p < arc) {
    setArcPoint(out, halfW - r, -halfH + r, r, -HALF_PI + (p / arc) * HALF_PI)
    return
  }
  p -= arc
  if (p < straightV) {
    out.x = halfW
    out.y = -halfH + r + p
    out.angle = HALF_PI
    return
  }
  p -= straightV
  if (p < arc) {
    setArcPoint(out, halfW - r, halfH - r, r, (p / arc) * HALF_PI)
    return
  }
  p -= arc
  if (p < straightH) {
    out.x = halfW - r - p
    out.y = halfH
    out.angle = Math.PI
    return
  }
  p -= straightH
  if (p < arc) {
    setArcPoint(out, -halfW + r, halfH - r, r, HALF_PI + (p / arc) * HALF_PI)
    return
  }
  p -= arc
  if (p < straightV) {
    out.x = -halfW
    out.y = halfH - r - p
    out.angle = 3 * HALF_PI
    return
  }
  p -= straightV
  // 左上角。最后一段兜底，不再判条件：浮点误差让 p 差一点点超出弧长时，
  // 也只是把光点停在这段弧的末尾（也就是起跑点），不会掉出去没人管。
  setArcPoint(out, -halfW + r, -halfH + r, r, Math.PI + Math.min(p / arc, 1) * HALF_PI)
}

/**
 * 落在某个圆角上：phi 是圆心指向光点的方向（同样是 y 向下的坐标系）。
 *
 * 切线方向永远比 phi 多转 90°，所以四段弧接上四条直边之后，
 * 朝向是一路从 0 连续涨到 2π 的——光点在转角是"拐过去"，不是"啪地换个方向"。
 * （最后回到上直边时会从 2π 跳回 0，但那是同一个方向，画面上看不出来。）
 */
function setArcPoint(out: EdgePoint, cx: number, cy: number, r: number, phi: number): void {
  out.x = cx + r * Math.cos(phi)
  out.y = cy + r * Math.sin(phi)
  out.angle = phi + HALF_PI
}
