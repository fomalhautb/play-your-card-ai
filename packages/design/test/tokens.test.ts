import { describe, expect, it } from 'vitest'
import { tokens } from '../src/index'

type Leaf = string | number

/** 把嵌套的令牌对象摊平成「点分路径 -> 值」，断言失败时能直接看出是哪一个令牌出的问题。 */
function flatten(node: unknown, prefix = ''): Array<[string, Leaf]> {
  if (typeof node === 'string' || typeof node === 'number') return [[prefix, node]]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('设计令牌', () => {
  it('只剩尺寸和时长两组', () => {
    // 正式版简化第 5 步把别的组全删了（理由见 src/index.ts 的文件头）。
    // 卡这一条是为了让「顺手又加一组颜色回来」这件事先在这儿绊一下：
    // 要加就得连同 README 的「收了什么」一起改。
    expect(Object.keys(tokens).sort()).toEqual(['duration', 'size'])
  })

  it('尺寸和时长都是正数', () => {
    // 尺寸是 px 数字、时长是秒，都不带单位，所以 0 或负数只可能是写错。
    const entries = [...flatten(tokens.size, 'size'), ...flatten(tokens.duration, 'duration')]
    for (const [name, value] of entries) {
      expect(typeof value, name).toBe('number')
      expect(value, name).toBeGreaterThan(0)
    }
  })

  it('战场小卡和卡面同比例', () => {
    // 不同比例的话，打出时那一段「卡面飞到格子上」的补间会把卡面拉变形。
    const { width, height, tileWidth, tileHeight, tileScale } = tokens.size.card
    expect(tileWidth / width).toBeCloseTo(tileHeight / height, 5)
    expect(tileScale).toBeCloseTo(tileWidth / width, 5)
  })

  it('触屏档的放大倍数不小于桌面档', () => {
    // 触屏档屏幕小，放大查看只会更大——反过来就说明那两档抄岔了。
    const card = tokens.size.card
    expect(card.revealScaleTouch).toBeGreaterThanOrEqual(card.revealScale)
    expect(card.revealScaleHeroTouch).toBeGreaterThanOrEqual(card.revealScaleHero)
  })
})
