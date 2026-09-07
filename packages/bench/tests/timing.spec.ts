/**
 * 《正式版架构》6.9 的时间指标。机器相关，只出数不设门禁（6.9：绝对值不作为门禁）。
 *
 * 和确定性那组的区别：有头开 GPU、**真实时钟**（manualClock: false，帧由 rAF 推），
 * 剧本只负责发指令等空闲。数字从 Chrome trace 里取，不在页面里自己计时。
 *
 * 默认不跑，要显式指定 project：`pnpm --filter @ai-duel/bench timing`。
 * CPU 节流倍数用环境变量 BENCH_CPU_THROTTLE 改，默认 4（6.9 要求四到六倍）。
 */

import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PROFILES } from '../src/node/profiles'
import type { TimingReport, TimingRow } from '../src/node/report'
import { renderTimingMarkdown } from '../src/node/report'
import { writeResult } from '../src/node/results'
import type { TimingStats } from '../src/node/trace'
import { medianStats, statsFrom } from '../src/node/trace'
import { scenarioNames } from '../src/scenarios/index'
import { FRAME_BUDGET_MS } from '../src/thresholds'
import { enableGpuTiming, gpuReport, initOptions, initScene, openBench, runQuiet } from './harness'
import { captureTrace, extractFrames, hasUv, traceScratchDir } from './tracing'

/** 6.9：每次跑五遍取中位数抗噪声。 */
const RUNS = 5
const CPU_THROTTLE = Number(process.env.BENCH_CPU_THROTTLE ?? 4)

const rows: TimingRow[] = []
let frameSource = '未知'

test.afterAll(() => {
  if (rows.length === 0) return
  const report: TimingReport = {
    generatedAt: new Date().toISOString(),
    runs: RUNS,
    cpuThrottling: CPU_THROTTLE,
    budgetMs: FRAME_BUDGET_MS,
    source: frameSource,
    rows,
  }
  writeResult('timing.json', `${JSON.stringify(report, null, 2)}\n`)
  writeResult('timing.md', renderTimingMarkdown(report))
})

test.describe('时间指标', () => {
  test.skip(!hasUv(), '本机没有 uv，跑不了 Perfetto 的 trace_processor')

  for (const profile of PROFILES) {
    for (const segment of scenarioNames()) {
      test(`${profile.name}/${segment}：跑五遍取中位数`, async ({ page }) => {
        test.setTimeout(600_000)
        await openBench(page)
        await page.setViewportSize({ width: profile.width, height: profile.height })

        const client = await page.context().newCDPSession(page)
        // 6.9：主线程指标在四到六倍 CPU 节流下测，近似 2018 年中端安卓的 CPU。
        // 它不节流 GPU，所以只约束 JS 一侧。
        await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

        const scratch = traceScratchDir()
        const opts = { ...initOptions(profile, false), overdrawSampleEvery: 0 }
        const perRun: TimingStats[] = []
        let gpu = { available: false, reason: '没跑到' } as Awaited<ReturnType<typeof gpuReport>>

        for (let run = 0; run < RUNS; run += 1) {
          await initScene(page, opts)
          await enableGpuTiming(page)
          const tracePath = join(scratch, `${profile.name}-${segment}-${run}.json`)
          const framesPath = join(scratch, `${profile.name}-${segment}-${run}.frames.json`)
          await captureTrace(client, tracePath, async () => {
            // 关掉逐帧记录：那一层每帧要读一次计数器、建几个对象，
            // 会直接算进这一趟要测的主线程脚本时间里。
            await runQuiet(page, segment)
          })
          gpu = await gpuReport(page)
          // 第一遍带上 --explain：换了 Chrome 版本、帧事件对不上时，
          // 终端里会列出 trace 里切片最多的 track，照着改 frames.py 的候选源。
          const frames = extractFrames(tracePath, framesPath, run === 0)
          frameSource = frames.source
          perRun.push(statsFrom(frames, FRAME_BUDGET_MS))
        }

        const stats = medianStats(perRun)
        rows.push({ profile: profile.name, segment, stats, gpu })

        // 唯一的硬断言：真的取到帧了。没取到就是 trace 类别或者帧事件选错了，
        // 这时候整张表都是 0，看着像「性能极好」——那比测试失败危险得多。
        expect(stats.frames, `没从 trace 里取到帧，来源=${frameSource}`).toBeGreaterThan(0)
        await client.detach()
      })
    }
  }
})
