/**
 * 《正式版架构》6.9 的确定性指标。机器无关，用硬上限断言。
 *
 * 三组断言：
 *   1. 每段剧本的数字不超过 thresholds.ts 的上限；
 *   2. 同一段剧本跑两遍数字完全一致（6.9 明说这本身就是一条断言）；
 *   3. 连跑十段之后强制 GC，堆和常驻纹理内存回到基线 5% 以内。
 *
 * 跑法：`pnpm --filter @ai-duel/bench bench`。
 */

import { expect, test } from '@playwright/test'
import { checkLimits, describeViolations, leakVerdict, observedFrom } from '../src/node/checkLimits'
import { PROFILES } from '../src/node/profiles'
import type { DeterministicRow } from '../src/node/report'
import { renderDeterministicMarkdown } from '../src/node/report'
import { scenarioNames } from '../src/scenarios/index'
import { LEAK_TOLERANCE, limitsFor, placeholderKeys } from '../src/thresholds'
import {
  contextSeen,
  createHeapSampler,
  heapAfterGc,
  initOptions,
  initScene,
  openBench,
  residentTextureBytes,
  runAndDispose,
  runOnly,
  runQuiet,
  runSegment,
  writeResult,
} from './harness'

const SEGMENTS = scenarioNames()

/** 收集起来最后一起写进 results/。Playwright 的 project 内是串行的，所以模块级变量够用。 */
const rows: DeterministicRow[] = []

test.afterAll(() => {
  if (rows.length === 0) return
  const report = {
    generatedAt: new Date().toISOString(),
    rows,
    placeholders: placeholderKeys(limitsFor('desktop')),
  }
  writeResult('deterministic.json', `${JSON.stringify(report, null, 2)}\n`)
  writeResult('deterministic.md', renderDeterministicMarkdown(report))
})

for (const profile of PROFILES) {
  test.describe(`${profile.name} ${profile.width}×${profile.height}@${profile.resolution}`, () => {
    for (const segment of SEGMENTS) {
      test(`${segment}：指标不超上限，且两遍完全一致`, async ({ page }) => {
        await openBench(page)
        const opts = initOptions(profile, true)
        const client = await page.context().newCDPSession(page)
        const heap = createHeapSampler(client)

        await initScene(page, opts)
        const first = await runOnly(page, segment)
        const summary = first.metrics.summary
        const actionFrames = summary.frames - summary.idleFrames

        // 堆采样单独跑一遍，而且关掉逐帧记录：
        // 采样框住的必须只有剧本本身，不含 init 的一次性分配，也不含骨架自己记账的开销。
        await initScene(page, opts)
        await heap.start()
        await runQuiet(page, segment)
        const allocatedBytes = await heap.stop()
        const heapBytesPerFrame = actionFrames === 0 ? 0 : allocatedBytes / actionFrames

        const limits = limitsFor(profile.name)
        const observed = {
          ...observedFrom(summary, first.overdraw.average),
          heapBytesPerFrame,
        }
        const violations = checkLimits(observed, limits)
        expect(violations, describeViolations(violations)).toEqual([])

        // 下面三条是「假绿」的防线：计数器没接上、剧本一帧没渲染、根本没空转，
        // 这三种情况下上面每一条上限都会顺利通过，而那比测试失败危险得多。
        expect(await contextSeen(page), '计数器没接管到 WebGL 上下文，所有数字都不可信').toBe(true)
        expect(summary.renders).toBeGreaterThan(0)
        expect(summary.idleFrames).toBeGreaterThan(0)

        // 6.9：同一段剧本产生的确定性指标必须一模一样。
        // 比到逐帧记录这一层：汇总只有峰值和总和，某一帧的绘制调用挪到了下一帧它看不出来。
        const second = await runSegment(page, opts, segment)
        expect(second.metrics.summary).toEqual(summary)
        expect(second.metrics.frames).toEqual(first.metrics.frames)
        expect(second.overdraw).toEqual(first.overdraw)

        rows.push({
          profile: profile.name,
          segment,
          summary,
          overdraw: first.overdraw.average,
          heapBytesPerFrame,
          violations,
        })
        await client.detach()
      })
    }
  })
}

test('泄漏：连跑十段之后堆和常驻纹理内存回到基线', async ({ page }) => {
  test.setTimeout(300_000)
  await openBench(page)
  const client = await page.context().newCDPSession(page)
  await client.send('Runtime.enable')

  // 手机档最短，跑十遍也不至于让这条测试变成最慢的一条。
  const profile = PROFILES.find((p) => p.name === 'mobile') ?? PROFILES[0]
  if (!profile) throw new Error('没有可用的视口档位')
  const opts = initOptions(profile, true)

  /*
   * 先空跑十几轮再取基线。
   *
   * 每一轮都会新建又销毁一个 WebGL 上下文和一整套 Pixi 系统，头十几轮里
   * 对象池、着色器缓存、字体度量缓存会一路涨到高水位；之后还剩每轮约 25 KB 的残留，
   * 那是 Pixi / 浏览器侧的东西，不是场景的。基线取在高水位之后，
   * 这条检查量到的才是「反复打十局有没有越用越多」。
   * 常驻纹理内存那条不受影响，它一直是精确回到 0 的。
   */
  const WARMUP_ROUNDS = 12
  for (let i = 0; i < WARMUP_ROUNDS; i += 1) {
    await runAndDispose(page, opts, 'flip')
  }
  const baselineHeap = await heapAfterGc(client)
  const baselineTexture = await residentTextureBytes(page)

  for (let i = 0; i < 10; i += 1) {
    await runAndDispose(page, opts, 'flip')
  }

  const afterHeap = await heapAfterGc(client)
  const afterTexture = await residentTextureBytes(page)

  const textureVerdict = leakVerdict(baselineTexture, afterTexture, LEAK_TOLERANCE)
  expect(textureVerdict.ok, `常驻纹理内存没回到基线：${baselineTexture} → ${afterTexture}`).toBe(
    true,
  )

  const heapVerdict = leakVerdict(baselineHeap, afterHeap, LEAK_TOLERANCE)
  expect(heapVerdict.ok, `JS 堆没回到基线：${baselineHeap} → ${afterHeap}`).toBe(true)
  await client.detach()
})
