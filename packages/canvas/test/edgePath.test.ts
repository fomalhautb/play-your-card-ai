/**
 * 落地追光那条圆角矩形路径的单元测试（fx/edgePath.ts）。
 *
 * 为什么值得单测：这条路径以前是直角矩形，光点在四个转角上会跑到卡的圆角外面去，
 * 一眼就看得出来。改成圆角之后靠肉眼很难确认"到底贴着轮廓没有"，
 * 下面几条把当初出问题的那几件事钉死：点在不在轮廓上、转角处会不会突然加速、朝向连不连续。
 *
 * 测的是纯数学，不需要 WebGL：HitFx 那半个类（精灵、补间）归截图回归管（6.6）。
 */

import { describe, expect, it } from 'vitest'
import { type EdgePath, type EdgePoint, edgePointAt, setEdgePath } from '../src/fx/edgePath'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../src/layout/fanMath'

/** 战场上小卡的尺寸，也就是真正落地时传进来的那一档。 */
const TILE = { width: CARD_WIDTH * 0.733333, height: CARD_HEIGHT * 0.733333 }
/** 这一档下的圆角半径：和卡面等比缩放，所以是令牌值乘同一个倍数。 */
const TILE_RADIUS = (CARD_RADIUS * TILE.width) / CARD_WIDTH

function pathOf(w: number, h: number): EdgePath {
  const path: EdgePath = {
    halfW: 0,
    halfH: 0,
    radius: 0,
    straightH: 0,
    straightV: 0,
    arc: 0,
    perimeter: 0,
    start: 0,
  }
  setEdgePath(path, w, h)
  return path
}

function pointAt(path: EdgePath, t: number): EdgePoint {
  const out: EdgePoint = { x: 0, y: 0, angle: 0 }
  edgePointAt(path, t, out)
  return out
}

/**
 * 圆角矩形的有符号距离：负数在里面、0 在轮廓上、正数在外面。
 * 和 fx/cardGlare.ts 着色器里裁卡角用的是同一个公式。
 */
function signedDistance(p: EdgePoint, path: EdgePath): number {
  const qx = Math.abs(p.x) - (path.halfW - path.radius)
  const qy = Math.abs(p.y) - (path.halfH - path.radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - path.radius
}

describe('setEdgePath：路径怎么量出来的', () => {
  it('半径跟着卡宽等比缩，和卡面同一个令牌', () => {
    expect(pathOf(CARD_WIDTH, CARD_HEIGHT).radius).toBeCloseTo(CARD_RADIUS)
    expect(pathOf(TILE.width, TILE.height).radius).toBeCloseTo(TILE_RADIUS)
  })

  it('一圈的总长 = 四条直边 + 一个整圆的周长', () => {
    const path = pathOf(TILE.width, TILE.height)
    const straights = 2 * (TILE.width - 2 * TILE_RADIUS) + 2 * (TILE.height - 2 * TILE_RADIUS)
    expect(path.perimeter).toBeCloseTo(straights + 2 * Math.PI * TILE_RADIUS)
    // 圆角吃掉的那点长度：直角矩形是 2(w+h)，圆角矩形一定比它短。
    expect(path.perimeter).toBeLessThan(2 * (TILE.width + TILE.height))
  })

  it('半径大过短边一半时被夹住，直边长度不会变成负数', () => {
    // 宽 400 高 12 的极端条：按比例算半径是 26.7，比半高 6 还大。
    const path = pathOf(400, 12)
    expect(path.radius).toBe(6)
    expect(path.straightV).toBe(0)
    expect(path.straightH).toBeGreaterThan(0)
  })
})

describe('edgePointAt：光点跑到哪儿、朝哪儿', () => {
  const path = pathOf(TILE.width, TILE.height)

  it('从上边中点起跑，跑满一圈回到同一点', () => {
    const start = pointAt(path, 0)
    expect(start.x).toBeCloseTo(0)
    expect(start.y).toBeCloseTo(-TILE.height / 2)
    expect(start.angle).toBeCloseTo(0)

    const end = pointAt(path, 1)
    expect(end.x).toBeCloseTo(start.x)
    expect(end.y).toBeCloseTo(start.y)
  })

  it('全程贴着圆角矩形的轮廓，一个点都不探到卡外', () => {
    for (let i = 0; i < 720; i += 1) {
      const p = pointAt(path, i / 720)
      // 贴着轮廓：有符号距离是 0。以前走直角时，四个转角处这个数会是 +2.1
      //（半径 7.33 的圆角，直角顶点到圆弧的距离 r − r/√2）。
      expect(signedDistance(p, path)).toBeCloseTo(0)
    }
  })

  it('转角处不加速：按弧长走，相邻两步的间距处处相等', () => {
    const steps = 360
    const gaps: number[] = []
    let prev = pointAt(path, 0)
    for (let i = 1; i <= steps; i += 1) {
      const next = pointAt(path, i / steps)
      gaps.push(Math.hypot(next.x - prev.x, next.y - prev.y))
      prev = next
    }
    // 每一步都是同样长的一段弧长。量出来的是弦长，所以在四个圆角上会比弧长短一丁点
    //（步长 1.49、半径 7.33 时短 0.003），两位小数够把它和"转角处提速"分开：
    // 按圆心角均分的话，同样一份时间在角上只走 r 那么一小段，间距会掉到六分之一。
    const expected = path.perimeter / steps
    for (const gap of gaps) expect(gap).toBeCloseTo(expected, 2)
  })

  it('朝向沿路连续，转角是拐过去而不是啪地换个方向', () => {
    const steps = 720
    /*
     * 一圈总共转 2π，但直边上一点都不转，2π 全发生在四段弧里，
     * 所以每一步最多转「这一步走了多长 ÷ 半径」（弧长和圆心角的关系）。
     * 直角矩形在四个转角上会一下子跳 π/2 ≈ 1.57，是这条测试要拦的东西。
     */
    const maxTurn = path.perimeter / steps / path.radius + 1e-9
    /*
     * 全程只允许折回一次：起跑点在上边中点，跑完左上角之后剩下半条上直边，
     * 那里朝向从 2π 折回 0。是同一个方向，画面上看不出来，但数值上要恰好差 2π。
     */
    let wraps = 0
    let prev = pointAt(path, 0).angle
    for (let i = 1; i <= steps; i += 1) {
      const angle = pointAt(path, i / steps).angle
      const delta = angle - prev
      if (delta < 0) {
        wraps += 1
        // 折回的那一步跨在左上角和上直边之间，所以是「−2π 再加上这一步真正转过的那点角度」。
        expect(delta).toBeGreaterThanOrEqual(-2 * Math.PI)
        expect(delta).toBeLessThanOrEqual(-2 * Math.PI + maxTurn)
      } else {
        expect(delta).toBeLessThanOrEqual(maxTurn)
      }
      prev = angle
    }
    expect(wraps).toBe(1)
  })

  it('t 超出 0~1 会绕回来，同一个 t 永远是同一个点', () => {
    for (const t of [0.37, 0.82]) {
      const base = pointAt(path, t)
      expect(pointAt(path, t)).toEqual(base)
      expect(pointAt(path, t + 3)).toEqual(base)
      expect(pointAt(path, t - 2)).toEqual(base)
    }
  })

  it('半径取 0 时退化成直角矩形，四个顶点都走得到', () => {
    const square = pathOf(TILE.width, TILE.height)
    square.radius = 0
    square.straightH = TILE.width
    square.straightV = TILE.height
    square.arc = 0
    square.perimeter = 2 * (TILE.width + TILE.height)
    square.start = TILE.width / 2
    // 从上边中点走过半条上边就到右上角，那儿正好是直角顶点。
    const corner = pointAt(square, TILE.width / 2 / square.perimeter)
    expect(corner.x).toBeCloseTo(TILE.width / 2)
    expect(corner.y).toBeCloseTo(-TILE.height / 2)
  })
})
