/**
 * 性能剧本：脚本化的操作序列、固定步进时钟、WebGL 计数器，对应《正式版架构》6.9 的确定性指标。
 *
 * 它是测量工具不是游戏的一部分，只被 CI 和本地压测调用，不进任何平台的构建产物。
 * 允许依赖：`canvas`（要驱动真实场景）、`design`、`platform`。
 *
 * 包分三层：
 *   - src/page/     跑在浏览器里，装计数器、建场景、按剧本推帧，产出 window.__bench
 *   - src/node/     跑在 Node 里，判阈值、解析 trace、出报告
 *   - src/metrics/、src/scene/、src/scenarios/  两边共用的类型和纯逻辑
 *
 * 这个入口只导出 Node 那半边和阈值：浏览器那半边由 index.html 直接加载 src/page/main.ts，
 * 不走包入口。怎么跑、指标怎么来的、阈值在哪改，见 README.md。
 *
 * 剧本在迁移第 2 条搭起来、第 20 条接进 CI。
 */

export { diffCounters, diffScene, summarize, zeroCounters } from './metrics/diff'
export type { GlCounterHandle } from './metrics/glCounters'
export {
  bytesPerPixel,
  levelBytes,
  mipmapExtraBytes,
  sourceSize,
  storageBytes,
} from './metrics/textureBytes'
export type {
  BenchMetrics,
  FrameRecord,
  GlCounters,
  OverdrawResult,
  SegmentSummary,
} from './metrics/types'
export type { LeakVerdict, Observed, Violation } from './node/checkLimits'
export { checkLimits, describeViolations, leakVerdict, observedFrom } from './node/checkLimits'
export type { Profile } from './node/profiles'
export { DECK, PROFILES, SEED } from './node/profiles'
export type {
  DeterministicReport,
  DeterministicRow,
  GpuTiming,
  TimingReport,
  TimingRow,
} from './node/report'
export { renderDeterministicMarkdown, renderTimingMarkdown } from './node/report'
export type { FramesReport, TimingStats } from './node/trace'
export { median, medianStats, parseFramesReport, percentile, statsFrom } from './node/trace'
export { FRAME_MS, SCENARIOS, scenarioNames } from './scenarios/index'
export type { CreateDuelPrototype, DuelPrototype, DuelPrototypeOptions } from './scene/contract'
export type { Limit, LimitKey, Limits, ProfileName } from './thresholds'
export { FRAME_BUDGET_MS, LEAK_TOLERANCE, LIMITS, limitsFor, placeholderKeys } from './thresholds'
