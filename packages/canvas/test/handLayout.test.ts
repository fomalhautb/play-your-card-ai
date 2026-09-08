/**
 * 扇形几何和 hover 让位的单元测试。
 *
 * 这几条不是"跑得通就行"，每一条都对应旧客户端里踩过一次的坑（见 fanMath.ts /
 * handLayout.ts 的注释）：扇形张角固定、放大倍数有几何下限、邻牌是被推着走的。
 * 数字变了这些测试就会红，改之前先回去看那些注释里写的理由。
 */

import { describe, expect, it } from 'vitest'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  fanTransform,
  GAP_PER_CARD,
  MAX_SPAN,
  PLAYER_FAN,
  SPREAD_DEG,
  tiltHalfExtent,
} from '../src/layout/fanMath'
import {
  HOVER_BOTTOM,
  HOVER_SCALE,
  handPoses,
  MIN_HOVER_SCALE,
  neighborPushes,
} from '../src/layout/handLayout'

/** 桌面档下一排手牌大致能铺开的宽度，够宽到不被"最外侧不许越界"那条卡住。 */
const WIDE = 1400

describe('fanTransform：一排牌摆在哪', () => {
  it('只有一张牌时不转、只按 sink 沉出去', () => {
    expect(fanTransform(0, 1, WIDE, PLAYER_FAN)).toEqual({ x: 0, y: PLAYER_FAN.sink, rotation: 0 })
  })

  it('两端永远是 ±SPREAD_DEG/2，几张牌都一样', () => {
    for (const count of [2, 3, 5, 8]) {
      expect(fanTransform(0, count, WIDE, PLAYER_FAN).rotation).toBeCloseTo(-SPREAD_DEG / 2)
      expect(fanTransform(count - 1, count, WIDE, PLAYER_FAN).rotation).toBeCloseTo(SPREAD_DEG / 2)
    }
  })

  it('整排关于中线对称', () => {
    const left = fanTransform(0, 5, WIDE, PLAYER_FAN)
    const right = fanTransform(4, 5, WIDE, PLAYER_FAN)
    expect(left.x).toBeCloseTo(-right.x)
    expect(left.y).toBeCloseTo(right.y)
  })

  it('两端比中间垂得低（y 向下为正）', () => {
    const middle = fanTransform(2, 5, WIDE, PLAYER_FAN)
    const edge = fanTransform(0, 5, WIDE, PLAYER_FAN)
    expect(edge.y).toBeGreaterThan(middle.y)
    // 下垂量就是 arcRadius × (1 − cos 倾角)，20° 时约 24px。
    expect(edge.y - PLAYER_FAN.sink).toBeCloseTo(
      PLAYER_FAN.arcRadius * (1 - Math.cos((SPREAD_DEG / 2 / 180) * Math.PI)),
    )
  })

  it('地方够宽时按理想间距排，牌与牌的距离就是 GAP_PER_CARD', () => {
    const a = fanTransform(1, 5, WIDE, PLAYER_FAN)
    const b = fanTransform(2, 5, WIDE, PLAYER_FAN)
    expect(b.x - a.x).toBeCloseTo(GAP_PER_CARD)
  })

  it('牌太多时总宽卡在 MAX_SPAN，间距被压缩而不是继续摊开', () => {
    const count = 20
    const span = (fanTransform(count - 1, count, WIDE, PLAYER_FAN).x -
      fanTransform(0, count, WIDE, PLAYER_FAN).x) as number
    // span 是"每张牌摊一格"的总宽，最外侧牌心之间只有 span × (count−1)/count。
    expect(span).toBeLessThanOrEqual(MAX_SPAN)
    expect(span).toBeCloseTo((MAX_SPAN * (count - 1)) / count)
  })

  it('地方窄的时候最外侧那张牌不许越过可用区域的边', () => {
    const areaWidth = 500
    const count = 6
    const edge = fanTransform(count - 1, count, areaWidth, PLAYER_FAN)
    // 倾斜之后横向要伸出 tiltHalfExtent，加上牌心的位置不能超过半个可用宽度。
    expect(edge.x + tiltHalfExtent(SPREAD_DEG / 2)).toBeLessThanOrEqual(areaWidth / 2)
  })
})

describe('hover 放大倍数的几何下限', () => {
  it('下限就是"盖住倾斜卡最远那个角"算出来的，40° 时约 1.9', () => {
    const tilt = ((SPREAD_DEG / 2) * Math.PI) / 180
    const expected =
      ((CARD_WIDTH / 2) * Math.cos(tilt) + CARD_HEIGHT * Math.sin(tilt)) / (CARD_WIDTH / 2)
    expect(MIN_HOVER_SCALE).toBeCloseTo(expected)
    expect(MIN_HOVER_SCALE).toBeGreaterThan(1.75)
  })

  it('实际用的倍数不许低于下限，否则会出现放大缩回的无限循环', () => {
    expect(HOVER_SCALE).toBeGreaterThanOrEqual(MIN_HOVER_SCALE)
  })
})

describe('neighborPushes：邻牌让位', () => {
  it('没人被 hover 时谁都不动', () => {
    expect(neighborPushes(-1, 5, WIDE, PLAYER_FAN)).toEqual([0, 0, 0, 0, 0])
  })

  it('被 hover 的那张自己不让位，左边往左让、右边往右让', () => {
    const pushes = neighborPushes(2, 5, WIDE, PLAYER_FAN)
    expect(pushes[2]).toBe(0)
    expect(pushes[1]).toBeLessThan(0)
    expect(pushes[0]).toBeLessThanOrEqual(pushes[1] as number)
    expect(pushes[3]).toBeGreaterThan(0)
    expect(pushes[4]).toBeGreaterThanOrEqual(pushes[3] as number)
  })

  it('同一侧的牌是被推着走的：让位量单调不减，彼此不会叠成一坨', () => {
    const pushes = neighborPushes(4, 9, WIDE, PLAYER_FAN)
    for (let i = 5; i < 9; i += 1) {
      expect(pushes[i]).toBeGreaterThanOrEqual(pushes[i - 1] as number)
    }
    for (let i = 3; i >= 0; i -= 1) {
      expect(pushes[i]).toBeLessThanOrEqual(pushes[i + 1] as number)
    }
  })

  it('让开之后邻牌的边和放大卡的边之间留得出余量', () => {
    const count = 5
    const hoverIndex = 2
    const pushes = neighborPushes(hoverIndex, count, WIDE, PLAYER_FAN)
    const hovered = fanTransform(hoverIndex, count, WIDE, PLAYER_FAN)
    const neighbor = fanTransform(3, count, WIDE, PLAYER_FAN)
    const neighborLeftEdge =
      neighbor.x +
      (pushes[3] ?? 0) -
      (CARD_WIDTH / 2) * Math.cos((neighbor.rotation / 180) * Math.PI)
    expect(neighborLeftEdge).toBeGreaterThanOrEqual(hovered.x + (CARD_WIDTH / 2) * HOVER_SCALE)
  })
})

describe('handPoses：整排姿态', () => {
  it('抬起来的那张转正、放大、竖直抬到贴着视口下沿', () => {
    const poses = handPoses(5, WIDE, PLAYER_FAN, 1)
    expect(poses[1]).toEqual({
      x: fanTransform(1, 5, WIDE, PLAYER_FAN).x,
      y: HOVER_BOTTOM,
      rotation: 0,
      scale: HOVER_SCALE,
    })
  })

  it('几张牌抬起来的高度是同一个，和自己原来沉了多少无关', () => {
    const edge = handPoses(5, WIDE, PLAYER_FAN, 0)[0]
    const middle = handPoses(5, WIDE, PLAYER_FAN, 2)[2]
    expect(edge?.y).toBe(middle?.y)
  })

  it('没被 hover 的牌保持基准尺寸', () => {
    const poses = handPoses(5, WIDE, PLAYER_FAN, 1)
    expect(poses.filter((_, i) => i !== 1).every((pose) => pose.scale === 1)).toBe(true)
  })
})
