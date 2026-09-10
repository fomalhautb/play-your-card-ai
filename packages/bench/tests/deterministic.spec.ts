/**
 * 《正式版架构》6.9 的确定性指标。机器无关，用硬上限断言。
 *
 * 三组断言：
 *   1. 每段剧本的数字不超过 thresholds.ts 的上限；
 *   2. 同一段剧本跑两遍数字完全一致（6.9 明说这本身就是一条断言）；
 *   3. 连跑十段之后强制 GC，堆和常驻纹理内存回到基线 5% 以内。
 *
 * 跑法：`pnpm --filter @ai-duel/bench bench`。用例之间没有耦合，并行跑（见 playwright.config.ts）。
 *
 * 每条都挂了一个标签（`@视口-剧本`、`@stub`、`@leak`），CI 慢档按它把整组拆成一格一格的
 * 并行 job（`.github/workflows/slow.yml`）。**标签是工作流的接口，不能随手改**：
 * 改了名字那一格会变成「一条用例都没匹配到」而不是失败，静悄悄地少跑一格。
 */

import { expect, test } from '@playwright/test'
import { checkLimits, describeViolations, leakVerdict, observedFrom } from '../src/node/checkLimits'
import { ROW_ATTACHMENT } from '../src/node/deterministicReporter'
import { PROFILES } from '../src/node/profiles'
import type { DeterministicRow } from '../src/node/report'
import { scenarioNames } from '../src/scenarios/index'
import { LEAK_TOLERANCE, limitsFor } from '../src/thresholds'
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
} from './harness'

const SEGMENTS = scenarioNames()

/**
 * 把自己这一行交给主进程的 reporter 去汇总。
 *
 * 不能在这里直接写 results/：这组用例是并行的，每个 worker 是独立进程，
 * 各写各的会互相覆盖（原因写在 src/node/deterministicReporter.ts）。
 */
async function reportRow(row: DeterministicRow): Promise<void> {
  await test.info().attach(ROW_ATTACHMENT, {
    body: JSON.stringify(row),
    contentType: 'application/json',
  })
}

for (const profile of PROFILES) {
  test.describe(`${profile.name} ${profile.width}×${profile.height}@${profile.resolution}`, () => {
    for (const segment of SEGMENTS) {
      test(`${segment}：指标不超上限，且两遍完全一致`, {
        tag: `@${profile.name}-${segment}`,
      }, async ({ page }) => {
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
        /*
         * 先把这一行交给报告，再断言。
         *
         * 反过来写的话，超限时 `expect` 当场抛出，报告里就没有这一行——而那正是最需要看到
         * 数字的时候（超了多少、别的指标各是什么样）。断言失败照样会让这条用例红。
         */
        await reportRow({
          profile: profile.name,
          segment,
          summary,
          overdraw: first.overdraw.average,
          heapBytesPerFrame,
          violations,
        })
        expect(violations, describeViolations(violations)).toEqual([])

        // 下面四条是「假绿」的防线：计数器没接上、剧本一帧没渲染、根本没空转，
        // 这三种情况下上面每一条上限都会顺利通过，而那比测试失败危险得多。
        // 最后一条防的是另一种假绿：场景里混进了外观换不掉的节点（Graphics、Text 之类），
        // 那次调试渲染给它们加的不是整数 1，过度绘制会偏小地通过（见 src/page/overdraw.ts）。
        expect(await contextSeen(page), '计数器没接管到 WebGL 上下文，所有数字都不可信').toBe(true)
        expect(summary.renders).toBeGreaterThan(0)
        expect(summary.idleFrames).toBeGreaterThan(0)
        expect(first.overdraw.unswapped, '有节点的外观换不掉，过度绘制的数字不可信').toBe(0)

        // 6.9：同一段剧本产生的确定性指标必须一模一样。
        // 比到逐帧记录这一层：汇总只有峰值和总和，某一帧的绘制调用挪到了下一帧它看不出来。
        const second = await runSegment(page, opts, segment)
        expect(second.metrics.summary).toEqual(summary)
        expect(second.metrics.frames).toEqual(first.metrics.frames)
        expect(second.overdraw).toEqual(first.overdraw)
        await client.detach()
      })
    }
  })
}

/**
 * 桩场景的冒烟：只确认测量骨架自己还是好的。
 *
 * 上面那批跑的是真实场景，真实场景一改，所有数字都会跟着变——那时候分不清是场景退步了
 * 还是计数器坏了。桩场景是唯一不会跟着一起变的对照组（见 src/scene/stubScene.ts），
 * 所以这里留一条：计数器接上了、剧本渲染了、空转停了、两遍一模一样。
 * 上限不在这里判：桩场景是刻意做得每条计数器都会动的固定物，不是要达标的东西。
 */
test('桩场景：测量骨架自身跑得通，且两遍完全一致', { tag: '@stub' }, async ({ page }) => {
  await openBench(page)
  const profile = PROFILES.find((p) => p.name === 'mobile') ?? PROFILES[0]
  if (!profile) throw new Error('没有可用的视口档位')
  const opts = initOptions(profile, true, 'stub')

  const first = await runSegment(page, opts, 'play10')
  expect(await contextSeen(page), '计数器没接管到 WebGL 上下文，所有数字都不可信').toBe(true)
  expect(first.metrics.summary.renders).toBeGreaterThan(0)
  expect(first.metrics.summary.idleFrames).toBeGreaterThan(0)
  expect(first.overdraw.nodes).toBeGreaterThan(0)

  const second = await runSegment(page, opts, 'play10')
  expect(second.metrics.summary).toEqual(first.metrics.summary)
  expect(second.metrics.frames).toEqual(first.metrics.frames)
  expect(second.overdraw).toEqual(first.overdraw)
})

test('泄漏：连跑十段之后堆和常驻纹理内存回到基线', { tag: '@leak' }, async ({ page }) => {
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
