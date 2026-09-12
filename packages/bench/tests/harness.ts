/**
 * Playwright 和测量页面之间的胶水：打开页面、调 `window.__bench`、写 results/。
 *
 * 所有 page.evaluate 都集中在这里，spec 里只剩「跑哪段、断言什么」。
 * 这样页面 API 一改，要跟着改的只有这一个文件。
 */

import type { CDPSession, Page } from '@playwright/test'
import type { BenchMetrics, OverdrawResult } from '../src/metrics/types'
import { DECK, type Profile, SEED } from '../src/node/profiles'
import type { BenchApi, BenchInitOptions, GpuReport, SceneKind } from '../src/page/benchApi'
import type { HitPoint } from '../src/page/hitPoints'
import type { KeyframeShots } from '../src/page/keyframes'
import { sceneOfScenario } from '../src/scenarios/index'
import type { DuelCommand } from '../src/scene/contract'

declare global {
  interface Window {
    __bench: BenchApi
  }
}

export interface SegmentRun {
  metrics: BenchMetrics
  overdraw: OverdrawResult
  /** 剧本跑完时的常驻纹理内存，泄漏检查拿它当基线。 */
  textureBytes: number
}

/** 这一段剧本要建哪个场景。剧本自己登记的（见 scenarios/types.ts 的 `Scenario.scene`）。 */
export function sceneOf(segment: string): SceneKind {
  return sceneOfScenario(segment)
}

/** @param scene 默认测 canvas 包的真实对局场景；剧本各自要哪个场景走 `sceneOf`。 */
export function initOptions(
  profile: Profile,
  manualClock: boolean,
  scene: SceneKind = 'duel',
): BenchInitOptions {
  return {
    profile: profile.name,
    width: profile.width,
    height: profile.height,
    resolution: profile.resolution,
    tier: profile.tier,
    seed: SEED,
    deck: [...DECK],
    manualClock,
    scene,
  }
}

export async function openBench(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__bench), null, { timeout: 60_000 })
  if (errors.length > 0) throw new Error(`页面报错：${errors.join('；')}`)
}

/**
 * 建场景。和跑剧本分成两步，是为了堆采样能只框住剧本那一段：
 * init 要建纹理、建对象池、预热，那是几百 KB 的一次性分配，
 * 算进「稳态每帧堆分配」里，短剧本会被这一笔直接顶穿上限。
 */
export async function initScene(page: Page, opts: BenchInitOptions): Promise<void> {
  await page.evaluate(async (options) => {
    await window.__bench.init(options as BenchInitOptions)
  }, opts)
}

/** 在已经 init 好的场景上跑一段剧本，返回这一段的全部指标。 */
export async function runOnly(page: Page, segment: string): Promise<SegmentRun> {
  return page.evaluate(async (name) => {
    await window.__bench.run(name as string)
    return {
      metrics: window.__bench.metrics(),
      overdraw: window.__bench.overdraw(),
      textureBytes: window.__bench.counters().textureBytes,
    }
  }, segment)
}

/** 重新建场景再跑一段。两遍之间不留任何残留状态，确定性那条断言靠的就是这个。 */
export async function runSegment(
  page: Page,
  opts: BenchInitOptions,
  segment: string,
): Promise<SegmentRun> {
  await initScene(page, opts)
  return runOnly(page, segment)
}

/** 在已经 init 好的场景上跑一段剧本，但不记录逐帧数据。堆采样用这一档。 */
export async function runQuiet(page: Page, segment: string): Promise<void> {
  await page.evaluate(async (name) => {
    await window.__bench.run(name as string, { record: false })
  }, segment)
}

/** 建场景、跑一段、拆掉，全程不记录。泄漏那一轮用。 */
export async function runAndDispose(
  page: Page,
  opts: BenchInitOptions,
  segment: string,
): Promise<void> {
  await page.evaluate(
    async ([options, name]) => {
      await window.__bench.init(options as BenchInitOptions)
      await window.__bench.run(name as string, { record: false })
      await window.__bench.reset()
    },
    [opts, segment] as const,
  )
}

export async function residentTextureBytes(page: Page): Promise<number> {
  return page.evaluate(() => window.__bench.counters().textureBytes)
}

/** 计数器有没有真的接管到 WebGL 上下文。为 false 时所有上限都会「通过」，那是假绿。 */
export async function contextSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__bench.contextSeen())
}

export async function enableGpuTiming(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__bench.enableGpuTiming())
}

export async function gpuReport(page: Page): Promise<GpuReport> {
  return page.evaluate(() => window.__bench.gpu())
}

/**
 * 交互用例那几件事（见 tests/interaction.spec.ts）。
 *
 * 和上面那些一样，`page.evaluate` 全集中在这个文件里：页面 API 一改，只有这里要跟着改。
 */

/** 开一局并把开局演出推完：手牌摆上屏幕、锁放开，可以开始点了。 */
export async function dealHand(page: Page): Promise<void> {
  await page.evaluate(() => window.__bench.deal())
}

/** 照脚本打出 n 张牌。英雄技能那条用例要靠它先在场上摆出一个单位。 */
export async function playScripted(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => window.__bench.play(n as number), count)
}

/** 把演出推完。真指针那几下之间要靠它——手动时钟下没人替我们推帧。 */
export async function settleScene(page: Page): Promise<void> {
  await page.evaluate(() => window.__bench.settle())
}

/** 场景到现在为止发出的指令。 */
export async function sceneCommands(page: Page): Promise<DuelCommand[]> {
  return page.evaluate(() => window.__bench.commands() as DuelCommand[])
}

/** 我方手牌，用来认出哪一张是技能牌。 */
export async function handCards(page: Page): Promise<{ instanceId: string; cardId: string }[]> {
  return page.evaluate(() => window.__bench.handCards().map((one) => ({ ...one })))
}

/**
 * 场景里 label 以 prefix 开头的那些对象，各给一个点得到的坐标。
 * 返回的是**画布内**坐标，加上画布在视口里的位置才是 page.mouse 要的那个点（见 viewportPoint）。
 */
export async function hitPoints(page: Page, prefix: string): Promise<HitPoint[]> {
  return page.evaluate((value) => window.__bench.hitPoints(value as string), prefix)
}

/**
 * 跑一段剧本，在指定帧号上各抓一张 PNG。
 * 返回的是解码好的 buffer——`toMatchSnapshot` 收的是二进制，不是 data URL。
 */
export async function captureKeyframes(
  page: Page,
  segment: string,
  stops: readonly number[],
): Promise<{ shots: Buffer[]; frames: number }> {
  const result = (await page.evaluate(
    async ([name, frames]) => window.__bench.keyframes(name as string, frames as number[]),
    [segment, [...stops]] as const,
  )) as KeyframeShots
  return {
    frames: result.frames,
    shots: result.shots.map((one) => Buffer.from(one.split(',')[1] ?? '', 'base64')),
  }
}

/** DevTools 协议的堆采样：一段剧本期间总共分配了多少字节。 */
export interface HeapSampler {
  start(): Promise<void>
  stop(): Promise<number>
}

interface SamplingNode {
  selfSize: number
  children?: SamplingNode[]
}

function totalSelfSize(node: SamplingNode): number {
  return (node.children ?? []).reduce((sum, child) => sum + totalSelfSize(child), node.selfSize)
}

export function createHeapSampler(client: CDPSession): HeapSampler {
  return {
    async start() {
      await client.send('HeapProfiler.enable')
      // 采样间隔越小估得越准，代价是开销。1 KiB 对「稳态每帧接近 0」这个量级够用了。
      await client.send('HeapProfiler.startSampling', { samplingInterval: 1024 })
    },
    async stop() {
      const result = (await client.send('HeapProfiler.stopSampling')) as {
        profile: { head: SamplingNode }
      }
      return totalSelfSize(result.profile.head)
    },
  }
}

/**
 * 强制 GC 之后的 JS 堆占用。泄漏那条检查比的就是它和基线。
 *
 * 连收三轮：一轮 GC 只能回收「这一轮判定为不可达」的东西，
 * 被 FinalizationRegistry 或者 WeakRef 拖着的对象要等下一轮才轮到，
 * 只收一次会把这部分算成泄漏。
 */
export async function heapAfterGc(client: CDPSession): Promise<number> {
  await client.send('HeapProfiler.enable')
  for (let i = 0; i < 3; i += 1) {
    await client.send('HeapProfiler.collectGarbage')
  }
  const usage = (await client.send('Runtime.getHeapUsage')) as { usedSize: number }
  return usage.usedSize
}
