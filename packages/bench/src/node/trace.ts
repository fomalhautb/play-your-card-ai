/**
 * 解析 scripts/frames.py 从 Chrome trace 里提出来的帧数据，算成 6.9 的时间指标。
 *
 * 6.9 明确要求「帧时间从 Chrome 的 trace 里取，用 Perfetto 的 trace_processor 提取，
 * 不在页面里自己计时」——页面里 performance.now 量到的是 JS 那一段，
 * 合成、光栅、上屏都不在里面，那个数好看但不代表用户看到的帧率。
 *
 * 这里只做算术，取数在 frames.py。分开是为了这一半能在 Node 里做单元测试。
 */

/** frames.py 的输出。字段名和那个脚本里的一一对应，改一边要改两边。 */
export interface FramesReport {
  /** 帧数据是从哪张表 / 哪种切片取的，报告里要写清楚，换了源数字就不可比。 */
  source: string
  /** 相邻两帧上屏的间隔，毫秒。这就是 6.9 说的「帧时间」。 */
  frameIntervalsMs: number[]
  /** 每帧从 BeginFrame 到上屏的管线延迟，毫秒。和帧间隔不是一回事，单独看。 */
  pipelineMs: number[]
  /** 主线程上 JS 执行占用的总时长，毫秒。重叠区间已经合并过，不会重复计。 */
  mainThreadScriptMs: number
  /** 取数时的旁证：候选表各有多少行。选错源时靠它排查。 */
  diagnostics?: Record<string, number>
}

export interface TimingStats {
  frames: number
  p50: number
  p95: number
  p99: number
  /** 超过帧预算两倍的帧数（6.9 时间指标那节）。 */
  jankFrames: number
  /** 管线延迟的 p95，帧间隔正常但延迟变长时能看出来。 */
  pipelineP95: number
  mainThreadScriptMs: number
}

/** 最近秩法：p 取 0~1。空数组返回 0，让调用方自己判断有没有取到数据。 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil(p * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index] as number
}

/** 偶数个取中间两个的平均。6.9 要求「每次跑五遍取中位数抗噪声」。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] as number
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

export function statsFrom(report: FramesReport, budgetMs: number): TimingStats {
  const intervals = report.frameIntervalsMs
  return {
    frames: intervals.length,
    p50: percentile(intervals, 0.5),
    p95: percentile(intervals, 0.95),
    p99: percentile(intervals, 0.99),
    jankFrames: intervals.filter((ms) => ms > budgetMs * 2).length,
    pipelineP95: percentile(report.pipelineMs, 0.95),
    mainThreadScriptMs: report.mainThreadScriptMs,
  }
}

/** 五遍取中位数：逐个指标各取各的中位数，不是挑「最中间那一遍」。 */
export function medianStats(runs: readonly TimingStats[]): TimingStats {
  const pick = (get: (s: TimingStats) => number) => median(runs.map(get))
  return {
    frames: pick((s) => s.frames),
    p50: pick((s) => s.p50),
    p95: pick((s) => s.p95),
    p99: pick((s) => s.p99),
    jankFrames: pick((s) => s.jankFrames),
    pipelineP95: pick((s) => s.pipelineP95),
    mainThreadScriptMs: pick((s) => s.mainThreadScriptMs),
  }
}

/** 把 frames.py 的 stdout 解析成 FramesReport，缺字段当场报错而不是后面算出 NaN。 */
export function parseFramesReport(text: string): FramesReport {
  const raw: unknown = JSON.parse(text)
  if (raw === null || typeof raw !== 'object') throw new Error('frames.py 的输出不是一个对象')
  const obj = raw as Record<string, unknown>
  const numbers = (key: string): number[] => {
    const value = obj[key]
    if (!Array.isArray(value) || value.some((n) => typeof n !== 'number')) {
      throw new Error(`frames.py 的输出里 ${key} 不是数字数组`)
    }
    return value as number[]
  }
  if (typeof obj.source !== 'string') throw new Error('frames.py 的输出里没有 source')
  if (typeof obj.mainThreadScriptMs !== 'number') {
    throw new Error('frames.py 的输出里没有 mainThreadScriptMs')
  }
  return {
    source: obj.source,
    frameIntervalsMs: numbers('frameIntervalsMs'),
    pipelineMs: numbers('pipelineMs'),
    mainThreadScriptMs: obj.mainThreadScriptMs,
    diagnostics: (obj.diagnostics as Record<string, number> | undefined) ?? undefined,
  }
}
