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

/** 阶梯必须严格递增：相邻两档一样大等于其中一档没用，多半是抄错了。 */
function expectAscending(name: string, ladder: Readonly<Record<string, number>>) {
  const steps = Object.entries(ladder)
  for (let i = 1; i < steps.length; i += 1) {
    const [prevKey, prev] = steps[i - 1]!
    const [key, value] = steps[i]!
    expect(value, `${name}: ${key} 应该大于 ${prevKey}`).toBeGreaterThan(prev)
  }
}

describe('设计令牌', () => {
  it('颜色一律是 #rrggbb', () => {
    // Pixi v8 和 CSS 都直接认这种写法，所以颜色令牌里不许出现别的形式；
    // 旧样式里带透明度的那几个颜色，透明度拆到了 opacity 那一组。
    for (const [name, value] of flatten(tokens.color)) {
      expect(value, `color.${name}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('尺寸和时长都是正数', () => {
    // TS 这边尺寸是 px 数字、时长是秒，都不带单位，所以 0 或负数只可能是写错。
    const entries = [...flatten(tokens.size, 'size'), ...flatten(tokens.duration, 'duration')]
    for (const [name, value] of entries) {
      expect(typeof value, name).toBe('number')
      expect(value, name).toBeGreaterThan(0)
    }
  })

  it('不透明度落在 0 到 1 之间', () => {
    for (const [name, value] of flatten(tokens.opacity, 'opacity')) {
      expect(typeof value, name).toBe('number')
      expect(value, name).toBeGreaterThan(0)
      expect(value, name).toBeLessThanOrEqual(1)
    }
  })

  it('字号阶梯单调递增', () => {
    expectAscending('font.size', tokens.font.size)
    expectAscending('font.sizeCqi', tokens.font.sizeCqi)
  })

  it('间距和圆角阶梯单调递增', () => {
    expectAscending('space', tokens.space)
    expectAscending('radius', tokens.radius)
  })

  it('字体栈是一行能直接写进 font-family 的字符串', () => {
    expect(tokens.font.family.serif).toContain('EB Garamond')
    expect(tokens.font.family.serif.endsWith('serif')).toBe(true)
  })
})
