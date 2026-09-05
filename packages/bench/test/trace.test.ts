import { describe, expect, it } from 'vitest'
import type { FramesReport } from '../src/node/trace'
import { median, medianStats, parseFramesReport, percentile, statsFrom } from '../src/node/trace'

const report = (patch: Partial<FramesReport> = {}): FramesReport => ({
  source: 'presented:args.frame_reporter',
  frameIntervalsMs: [16.7, 16.7, 16.6, 50, 16.7],
  pipelineMs: [30, 32, 41, 60, 33],
  mainThreadScriptMs: 17.5,
  ...patch,
})

describe('percentile', () => {
  it('最近秩法', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(values, 0.5)).toBe(5)
    expect(percentile(values, 0.95)).toBe(10)
    expect(percentile(values, 0.99)).toBe(10)
  })

  it('不要求入参有序', () => {
    expect(percentile([9, 1, 5], 0.5)).toBe(5)
  })

  it('空数组返回 0，让调用方自己判断有没有取到数据', () => {
    expect(percentile([], 0.5)).toBe(0)
  })
})

describe('median', () => {
  it('奇数取中间，偶数取中间两个的平均', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('statsFrom', () => {
  it('卡顿帧是超过预算两倍的那些', () => {
    const stats = statsFrom(report(), 16.667)
    // 只有 50ms 那一帧超过 33.3ms。
    expect(stats.jankFrames).toBe(1)
    expect(stats.frames).toBe(5)
    expect(stats.p50).toBe(16.7)
  })

  it('管线延迟和帧间隔分开算', () => {
    // 两帧可以同时在管线里，所以延迟远大于间隔，混成一个数会看不懂。
    const stats = statsFrom(report(), 16.667)
    expect(stats.pipelineP95).toBe(60)
    expect(stats.mainThreadScriptMs).toBe(17.5)
  })
})

describe('medianStats', () => {
  it('逐个指标各取各的中位数', () => {
    const runs = [
      statsFrom(report({ frameIntervalsMs: [10, 10, 10] }), 16.667),
      statsFrom(report({ frameIntervalsMs: [20, 20, 20] }), 16.667),
      statsFrom(report({ frameIntervalsMs: [30, 30, 30] }), 16.667),
    ]
    expect(medianStats(runs).p50).toBe(20)
  })
})

describe('parseFramesReport', () => {
  it('正常输出能解析', () => {
    const parsed = parseFramesReport(JSON.stringify(report()))
    expect(parsed.source).toBe('presented:args.frame_reporter')
    expect(parsed.frameIntervalsMs).toHaveLength(5)
  })

  it('缺字段当场报错，而不是后面算出 NaN', () => {
    expect(() => parseFramesReport('{}')).toThrow(/source/)
    expect(() => parseFramesReport('{"source":"x"}')).toThrow(/mainThreadScriptMs/)
    expect(() =>
      parseFramesReport('{"source":"x","mainThreadScriptMs":1,"frameIntervalsMs":["a"]}'),
    ).toThrow(/frameIntervalsMs/)
  })

  it('不是对象也要报错', () => {
    expect(() => parseFramesReport('null')).toThrow()
    expect(() => parseFramesReport('42')).toThrow()
  })
})
