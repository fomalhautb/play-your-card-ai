/**
 * 首页人物 alpha 命中判定的纯函数（`scenes/home/castHit.ts`）。
 *
 * 用例照搬黑客松版的 `test/castHitTest.test.ts` 的思路：手搓几张小掩码，
 * 断言包围盒、叠放优先级、遮挡层、越界。掩码从纹理烤出来那一步要 GPU，不在这里测——
 * 那一段由目录页的截图回归兜着（人物高亮那条条目亮的就是它算出来的那个人）。
 */

import { describe, expect, it } from 'vitest'
import type { AlphaMask } from '../src/scenes/home/castHit'
import { alphaBBox, CAST_ALPHA_THRESHOLD, hitTestMasks } from '../src/scenes/home/castHit'

/** 按一个「这个格子算不算不透明」的判据造一张掩码。 */
function mask(width: number, height: number, opaque: (x: number, y: number) => boolean): AlphaMask {
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      alpha[y * width + x] = opaque(x, y) ? 255 : 0
    }
  }
  return { width, height, alpha, bbox: alphaBBox(alpha, width, height) }
}

/** 左半边不透明的一张。 */
const LEFT = mask(10, 10, (x) => x < 5)
/** 右半边不透明的一张。 */
const RIGHT = mask(10, 10, (x) => x >= 5)
/** 整张不透明。 */
const FULL = mask(10, 10, () => true)
/** 整张全透明。 */
const EMPTY = mask(10, 10, () => false)

describe('alphaBBox', () => {
  it('包围盒是 0~1 的比例，右下边界按像素占的那一整格算', () => {
    // 左半边不透明：x 从下标 0 到 4，占 [0, 5) 这五格，也就是 0 到 0.5。
    expect(LEFT.bbox).toEqual({ minX: 0, minY: 0, maxX: 0.5, maxY: 1 })
  })

  it('整张全透明时没有包围盒', () => {
    expect(EMPTY.bbox).toBeNull()
  })

  it('只有一个不透明像素时包围盒正好圈住那一格', () => {
    const dot = mask(10, 10, (x, y) => x === 3 && y === 7)
    expect(dot.bbox).toEqual({ minX: 0.3, minY: 0.7, maxX: 0.4, maxY: 0.8 })
  })

  it('半透明的羽化边按阈值算：低于 64 的不算人身上', () => {
    const alpha = new Uint8Array([CAST_ALPHA_THRESHOLD - 1, CAST_ALPHA_THRESHOLD, 0, 0])
    expect(alphaBBox(alpha, 2, 2)).toEqual({ minX: 0.5, minY: 0, maxX: 1, maxY: 0.5 })
  })
})

describe('hitTestMasks', () => {
  it('点在谁身上就返回谁的下标', () => {
    expect(hitTestMasks([LEFT, RIGHT], 0.2, 0.5)).toBe(0)
    expect(hitTestMasks([LEFT, RIGHT], 0.8, 0.5)).toBe(1)
  })

  it('两个人重叠的地方判给排在后面的那个（站在前排的盖住后排的）', () => {
    expect(hitTestMasks([FULL, RIGHT], 0.8, 0.5)).toBe(1)
    // 左半边只有 FULL 盖到，所以还是判给它。
    expect(hitTestMasks([FULL, RIGHT], 0.2, 0.5)).toBe(0)
  })

  it('谁都没盖到就是 null', () => {
    expect(hitTestMasks([EMPTY, EMPTY], 0.5, 0.5)).toBeNull()
  })

  it('遮挡层压住的地方不算命中——指着桌子不该高亮它后面的人', () => {
    expect(hitTestMasks([FULL], 0.2, 0.5, [LEFT])).toBeNull()
    // 遮挡层没盖到的那半边照常命中。
    expect(hitTestMasks([FULL], 0.8, 0.5, [LEFT])).toBe(0)
  })

  it('越界坐标一律不命中，NaN 也一样', () => {
    expect(hitTestMasks([FULL], -0.01, 0.5)).toBeNull()
    expect(hitTestMasks([FULL], 0.5, 1)).toBeNull()
    expect(hitTestMasks([FULL], Number.NaN, 0.5)).toBeNull()
  })

  it('空掩码（烤失败的那张）永远不命中，不会把整页拖垮', () => {
    const broken: AlphaMask = { width: 0, height: 0, alpha: new Uint8Array(0), bbox: null }
    expect(hitTestMasks([broken, LEFT], 0.2, 0.5)).toBe(1)
    expect(hitTestMasks([broken], 0.2, 0.5)).toBeNull()
  })
})
