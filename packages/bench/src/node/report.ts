/**
 * 把跑批结果写成 results/ 下的 JSON 和一张 markdown 表。
 *
 * JSON 是给机器看的（以后接 github-action-benchmark 做趋势和回归门禁，见 6.12），
 * markdown 是给人看的：谁改了一版渲染，直接贴这张表就知道哪一格动了。
 * results/ 进了 .gitignore——它是每台机器各跑各的产物，提交进仓库只会天天冲突。
 */

import type { SegmentSummary } from '../metrics/types'
import type { LimitKey } from '../thresholds'
import type { Violation } from './checkLimits'
import type { TimingStats } from './trace'

export interface GpuTiming {
  available: boolean
  /** 可用时的每帧 GPU 耗时（毫秒）。 */
  averageMs?: number
  /** 不可用时写清楚为什么，别让一行空白看着像 0。 */
  reason?: string
}

export interface TimingRow {
  profile: string
  segment: string
  stats: TimingStats
  gpu: GpuTiming
}

export interface TimingReport {
  generatedAt: string
  /** 6.9：每次跑五遍取中位数。 */
  runs: number
  /** DevTools 协议的 CPU 节流倍数，6.9 要求四到六倍。 */
  cpuThrottling: number
  budgetMs: number
  /** 帧数据取自 trace 的哪种切片，见 trace.ts 的说明。 */
  source: string
  rows: TimingRow[]
}

export interface DeterministicRow {
  profile: string
  segment: string
  summary: SegmentSummary
  overdraw: number
  heapBytesPerFrame: number
  violations: Violation[]
}

export interface DeterministicReport {
  generatedAt: string
  rows: DeterministicRow[]
  /** 还是占位值的上限，提醒迁移第 3 条要填实。 */
  placeholders: LimitKey[]
}

const num = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : String(value)

const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

export function renderTimingMarkdown(report: TimingReport): string {
  const rows = report.rows.map((row) => [
    row.profile,
    row.segment,
    String(row.stats.frames),
    num(row.stats.p50),
    num(row.stats.p95),
    num(row.stats.p99),
    String(row.stats.jankFrames),
    num(row.stats.pipelineP95),
    num(row.stats.mainThreadScriptMs, 1),
    row.gpu.available ? num(row.gpu.averageMs ?? 0, 3) : `不可用（${row.gpu.reason ?? '未知'}）`,
  ])
  return [
    '# 时间指标',
    '',
    `生成时间：${report.generatedAt}`,
    `每段跑 ${report.runs} 遍取中位数；CPU 节流 ${report.cpuThrottling} 倍；` +
      `帧预算 ${num(report.budgetMs)} ms；帧数据源：${report.source}`,
    '',
    table(
      [
        '视口',
        '剧本',
        '帧数',
        'p50 (ms)',
        'p95 (ms)',
        'p99 (ms)',
        '卡顿帧',
        '管线 p95 (ms)',
        '主线程脚本 (ms)',
        'GPU 每帧 (ms)',
      ],
      rows,
    ),
    '',
    '> 绝对值不作为门禁（6.9）。要看的是和 main 分支比有没有退步超过 10%。',
    '',
  ].join('\n')
}

export function renderDeterministicMarkdown(report: DeterministicReport): string {
  const rows = report.rows.map((row) => [
    row.profile,
    row.segment,
    String(row.summary.frames),
    String(row.summary.maxDrawCalls),
    String(row.summary.maxBatchBreaks),
    String(row.summary.maxOffscreenBinds),
    num(row.overdraw, 3),
    String(row.summary.textureUploads),
    `${num(row.summary.peakTextureBytes / 1024 / 1024)} MiB`,
    String(row.summary.shaderCompiles),
    String(row.summary.syncCalls),
    String(row.summary.textCreated),
    num(row.heapBytesPerFrame, 0),
    String(
      Math.max(row.summary.idleRenders, row.summary.idleFrameRequests, row.summary.idleRafRequests),
    ),
    row.violations.length === 0 ? '通过' : `超限 ${row.violations.length} 条`,
  ])
  return [
    '# 确定性指标',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    table(
      [
        '视口',
        '剧本',
        '帧数',
        '每帧绘制调用',
        '合批打断',
        '离屏渲染',
        '过度绘制',
        '纹理上传',
        '常驻纹理',
        '着色器编译',
        '同步调用',
        '文字重建',
        '每帧堆分配 (B)',
        '空闲帧循环',
        '结论',
      ],
      rows,
    ),
    '',
    report.placeholders.length === 0
      ? ''
      : `> 还是占位值的上限：${report.placeholders.join('、')}。迁移第 3 条要用真实场景的结果填实。`,
    '',
  ].join('\n')
}
