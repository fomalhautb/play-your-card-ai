/**
 * 把一段剧本的汇总折成「6.9 表里那几个数」，再和 thresholds.ts 的上限比。
 *
 * 纯函数，不碰浏览器也不碰 Playwright，所以 `pnpm test` 的 vitest 能直接测它。
 * 断言语句本身留在 spec 里，这里只回答「哪几条超了、超了多少」。
 */

import type { SegmentSummary } from '../metrics/types'
import type { LimitKey, Limits } from '../thresholds'

/** 一段剧本实测到的数，key 和 thresholds.ts 的 LimitKey 一一对应。 */
export type Observed = Partial<Record<LimitKey, number>>

export interface Violation {
  key: LimitKey
  actual: number
  limit: number
  discipline: string
  /** 上限还是占位值时带上，报告里要区分「真的超了」和「占位值定低了」。 */
  todo?: string
}

/**
 * 汇总 → 实测值。
 *
 * 「空闲时帧循环」取三个空闲计数里最大的一个：场景自报的渲染次数、场景自报的取帧次数、
 * 页面层数到的 rAF 次数。任何一个不是 0 都说明帧循环没停，取最大值就不用分三条断言。
 */
export function observedFrom(summary: SegmentSummary, overdraw?: number): Observed {
  return {
    drawCallsPerFrame: summary.maxDrawCalls,
    batchBreaksPerFrame: summary.maxBatchBreaks,
    offscreenBindsPerFrame: summary.maxOffscreenBinds,
    textureUploads: summary.textureUploads,
    residentTextureBytes: summary.peakTextureBytes,
    shaderCompiles: summary.shaderCompiles,
    programLinks: summary.programLinks,
    syncCalls: summary.syncCalls,
    textCreated: summary.textCreated,
    idleFrameLoop: Math.max(
      summary.idleRenders,
      summary.idleFrameRequests,
      summary.idleRafRequests,
    ),
    ...(overdraw === undefined ? {} : { overdrawMultiple: overdraw }),
  }
}

/** 超了的条目。没测到的指标（值是 undefined）跳过，不当成 0 通过。 */
export function checkLimits(observed: Observed, limits: Limits): Violation[] {
  const out: Violation[] = []
  for (const key of Object.keys(limits) as LimitKey[]) {
    const actual = observed[key]
    if (actual === undefined) continue
    const limit = limits[key]
    if (actual <= limit.value) continue
    out.push({ key, actual, limit: limit.value, discipline: limit.discipline, todo: limit.todo })
  }
  return out
}

export function describeViolations(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `${v.key}: 实测 ${v.actual}，上限 ${v.limit}（纪律 ${v.discipline}）` +
        (v.todo ? `【${v.todo}】` : ''),
    )
    .join('\n')
}

export interface LeakVerdict {
  baseline: number
  after: number
  /** 相对基线的偏差比例，负数表示比基线还小。 */
  drift: number
  ok: boolean
}

/**
 * 泄漏判定：连打十局、强制 GC 之后回没回到基线。
 *
 * 基线是 0 时不能算比例（除零），这时要求结束值也是 0——从「一点都没有」变成「有一些」
 * 本身就是泄漏，多少都不能算通过。
 */
export function leakVerdict(baseline: number, after: number, tolerance: number): LeakVerdict {
  if (baseline === 0) {
    return { baseline, after, drift: after === 0 ? 0 : Number.POSITIVE_INFINITY, ok: after === 0 }
  }
  const drift = (after - baseline) / baseline
  return { baseline, after, drift, ok: drift <= tolerance }
}
