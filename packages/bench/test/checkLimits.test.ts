import { describe, expect, it } from 'vitest'
import type { SegmentSummary } from '../src/metrics/types'
import { checkLimits, describeViolations, leakVerdict, observedFrom } from '../src/node/checkLimits'
import type { Limits } from '../src/thresholds'
import { LIMITS, limitsFor, placeholderKeys } from '../src/thresholds'

const summary = (patch: Partial<SegmentSummary> = {}): SegmentSummary => ({
  segment: 'deal',
  frames: 45,
  idleFrames: 30,
  maxDrawCalls: 2,
  maxBatchBreaks: 16,
  maxOffscreenBinds: 0,
  textureUploads: 0,
  shaderCompiles: 0,
  programLinks: 0,
  syncCalls: 0,
  textCreated: 0,
  peakTextureBytes: 2_056_200,
  endTextureBytes: 2_056_200,
  idleRenders: 0,
  idleFrameRequests: 0,
  idleRafRequests: 0,
  renders: 15,
  ...patch,
})

describe('observedFrom', () => {
  it('空闲时帧循环取三个空闲计数里最大的那个', () => {
    // 三个来源任何一个不是 0 都说明帧循环没停，取最大值就不用写三条断言。
    const observed = observedFrom(
      summary({ idleRenders: 0, idleFrameRequests: 2, idleRafRequests: 1 }),
    )
    expect(observed.idleFrameLoop).toBe(2)
  })

  it('没测过度绘制就不带这一项，避免被当成 0 通过', () => {
    expect(observedFrom(summary()).overdrawMultiple).toBeUndefined()
    expect(observedFrom(summary(), 2.4).overdrawMultiple).toBe(2.4)
  })
})

describe('checkLimits', () => {
  const limits: Limits = limitsFor('mobile')

  it('桩场景那种数字一条都不超', () => {
    expect(checkLimits(observedFrom(summary(), 1.2), limits)).toEqual([])
  })

  it('等于上限算通过，超一点就报', () => {
    expect(checkLimits({ drawCallsPerFrame: 200 }, limits)).toEqual([])
    expect(checkLimits({ drawCallsPerFrame: 201 }, limits)).toHaveLength(1)
  })

  it('没测到的指标跳过，不当成 0 通过', () => {
    // 页面没跑起来时所有值都是 undefined，这时候「全部通过」是最危险的结论。
    expect(checkLimits({}, limits)).toEqual([])
    expect(checkLimits({ syncCalls: 1 }, limits)).toHaveLength(1)
  })

  it('超限条目带上纪律编号和占位标记', () => {
    const violations = checkLimits({ offscreenBindsPerFrame: 1 }, limits)
    expect(violations[0]?.discipline).toContain('3.1')
    // 手机档这条不是占位值：纪律 3.1 说死了移动端一次离屏都不许有。
    expect(violations[0]?.todo).toBeUndefined()
    expect(describeViolations(violations)).toContain('offscreenBindsPerFrame')
  })

  it('桌面档的离屏上限还是占位值', () => {
    const violations = checkLimits({ offscreenBindsPerFrame: 99 }, limitsFor('desktop'))
    expect(violations[0]?.todo).toBeDefined()
  })
})

describe('placeholderKeys', () => {
  it('列出还没填实的上限，两档都得有几条', () => {
    // 迁移第 3 条要求用真实场景的验证结果把这些填实并写回架构文档，
    // 这条断言只保证「还没填」这件事一直看得见。
    for (const profile of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      expect(placeholderKeys(LIMITS[profile]).length).toBeGreaterThan(0)
    }
  })
})

describe('leakVerdict', () => {
  it('偏差在容差内算通过', () => {
    expect(leakVerdict(1000, 1040, 0.05).ok).toBe(true)
    expect(leakVerdict(1000, 1060, 0.05).ok).toBe(false)
  })

  it('比基线还小当然算通过', () => {
    const verdict = leakVerdict(1000, 800, 0.05)
    expect(verdict.ok).toBe(true)
    expect(verdict.drift).toBeCloseTo(-0.2)
  })

  it('基线是 0 时只有结束也是 0 才算通过', () => {
    // 除零算不出比例；而且从「一点都没有」变成「有一些」本身就是泄漏。
    expect(leakVerdict(0, 0, 0.05).ok).toBe(true)
    expect(leakVerdict(0, 1, 0.05).ok).toBe(false)
    expect(leakVerdict(0, 1, 0.05).drift).toBe(Number.POSITIVE_INFINITY)
  })
})
