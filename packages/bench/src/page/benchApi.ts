/**
 * `window.__bench`：Playwright 从 Node 那边操纵页面的唯一入口。
 *
 * 一次测量的顺序固定是 init → run → metrics / overdraw → reset。
 * setup 阶段的帧不记录：它只是把场景摆到被测动作开始前的样子，混进去会污染峰值。
 */

import { diffCounters, diffScene, summarize } from '../metrics/diff'
import type { FrameLoopHandle } from '../metrics/frameLoop'
import type { GlCounterHandle } from '../metrics/glCounters'
import type { FrameRecord, OverdrawResult } from '../metrics/types'
import type { FrameDriver, SceneKind } from '../scenarios/index'
import { createContext, FRAME_MS, runIdle, SCENARIOS } from '../scenarios/index'
import { DEFAULT_ATLAS } from '../scene/atlas'
import type { BenchScene, CardTextures } from '../scene/contract'
import { createDeckSession } from '../scene/deckSession'
import { createDuelSession } from '../scene/duelSession'
import { createStubDuelScene } from '../scene/stubScene'
import type { LoadedTextures } from '../scene/textures'
import { createProceduralTextures, createWhiteTexture, loadAtlasTextures } from '../scene/textures'
import type { BenchApi, BenchInitOptions } from './benchContract'
import { grabFrame } from './grabFrame'
import { captureKeyframes } from './keyframes'
import { measureOverdraw } from './overdraw'
import type { RenderProbe } from './renderProbe'

interface Session {
  opts: BenchInitOptions
  canvas: HTMLCanvasElement
  scene: BenchScene
  textures: LoadedTextures
  white: ReturnType<typeof createWhiteTexture>
}

const DEFAULT_IDLE_FRAMES = 30
const DEFAULT_OVERDRAW_SAMPLE_EVERY = 25
/**
 * 一段剧本里最多采几次过度绘制。
 * 每次都要读回一整屏像素，软件渲染下一次好几百毫秒，采多了跑批时间会翻倍。
 */
const MAX_OVERDRAW_SAMPLES = 10

/**
 * 纹理从哪来。
 *
 * 真实场景默认走图集：6.9 的「常驻纹理内存」量的必须是真实资源，程序生成的纯色卡面
 * 只有几十 KB，那条预算就永远通过。桩场景反过来默认走程序生成——它是测量骨架的固定物，
 * 不该依赖一份要先跑 `pnpm assets:build` 才存在的产物。
 */
async function makeTextures(opts: BenchInitOptions): Promise<LoadedTextures> {
  // 桩场景之外都走图集：6.9 的「常驻纹理内存」量的必须是真实资源。
  const atlas = opts.atlas ?? (opts.scene === 'stub' ? undefined : DEFAULT_ATLAS)
  if (atlas) return loadAtlasTextures(opts.deck, atlas)
  return createProceduralTextures(opts.deck)
}

const SESSIONS: Record<SceneKind, typeof createDuelSession> = {
  duel: createDuelSession,
  deck: createDeckSession,
  stub: createStubDuelScene,
}

async function makeScene(
  opts: BenchInitOptions,
  canvas: HTMLCanvasElement,
  textures: CardTextures,
): Promise<BenchScene> {
  const create = SESSIONS[opts.scene ?? 'duel']
  return create({
    canvas,
    width: opts.width,
    height: opts.height,
    resolution: opts.resolution,
    tier: opts.tier,
    seed: opts.seed,
    textures,
    manualClock: opts.manualClock,
    ...(opts.duelDeck === undefined ? {} : { deck: opts.duelDeck }),
    ...(opts.duelHero === undefined ? {} : { hero: opts.duelHero }),
  })
}

/**
 * @param defaultScene init 没指定 scene 时测哪个场景。页面从 URL 的 `?scene=` 取，
 *   跑批那边则由 Playwright 显式传进来，两条路都不用改代码就能切到桩场景。
 */
export function createBenchApi(
  glCounters: GlCounterHandle,
  frameLoop: FrameLoopHandle,
  probe: RenderProbe,
  defaultScene: SceneKind = 'duel',
): BenchApi {
  let session: Session | null = null
  let frames: FrameRecord[] = []
  let segment = ''
  let phase: FrameRecord['phase'] = 'action'
  let recording = false
  let peakOverdraw: OverdrawResult | null = null
  let overdrawSamples = 0

  const need = (): Session => {
    if (!session) throw new Error('还没 init')
    return session
  }

  const sampleOverdraw = () => {
    const current = need()
    const every = current.opts.overdrawSampleEvery ?? DEFAULT_OVERDRAW_SAMPLE_EVERY
    if (every <= 0 || overdrawSamples >= MAX_OVERDRAW_SAMPLES) return
    if (frames.length % every !== 0) return
    overdrawSamples += 1
    const result = measureNow()
    if (!peakOverdraw || result.average > peakOverdraw.average) peakOverdraw = result
  }

  const measureNow = (): OverdrawResult => {
    const current = need()
    const renderer = probe.renderer()
    const stage = probe.stage()
    if (!renderer || !stage) throw new Error('没抓到 Pixi 的渲染调用，量不了过度绘制')
    return measureOverdraw(renderer, stage, current.white, current.opts.width, current.opts.height)
  }

  /**
   * 记一帧：advance 前后各取一次快照，差就是这一帧干的事。
   *
   * 过度绘制的采样放在快照窗口**之外**——那一趟调试渲染自己也要建 RenderTexture、
   * 读回像素，算进这一帧的话绘制调用和同步调用全会虚高。
   */
  const record = (advance: () => void) => {
    const current = need()
    if (!recording) {
      advance()
      return
    }
    const glBefore = glCounters.snapshot()
    const sceneBefore = current.scene.counters()
    const rafBefore = frameLoop.requests()
    advance()
    frames.push({
      index: frames.length,
      phase,
      gl: diffCounters(glBefore, glCounters.snapshot()),
      scene: diffScene(sceneBefore, current.scene.counters()),
      rafRequests: frameLoop.requests() - rafBefore,
    })
    if (phase === 'action') sampleOverdraw()
  }

  const driver = (): FrameDriver => {
    const current = need()
    return {
      manual: current.opts.manualClock,
      step: () => record(() => current.scene.step(FRAME_MS)),
      waitFrame: async () => {
        /*
         * 真实时钟：**画面**由场景自己的帧循环推，这里等一帧过去再取快照。
         *
         * 但 `scene.step` 还是得叫——剧本这一侧的东西只在它里面走：编排层按这一帧的
         * 实际间隔排期、等着收尾的动作靠它才兑现。不叫的话 `ctx.act` 永远等不到
         * 那个 Promise，剧本会一路推到上限然后报「推了 3000 帧还没结束」
         *（这正是时间指标那一档从前跑不起来的原因）。场景那边不会因此被推两遍：
         * 真实时钟下它的 `step` 只转给剧本这一侧，见 scene/duelSession.ts 的说明。
         */
        const before = performance.now()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        const deltaMs = performance.now() - before
        record(() => current.scene.step(deltaMs))
      },
    }
  }

  const api: BenchApi = {
    async init(raw) {
      // scene 在这里就定死，后面 makeTextures / makeScene / metrics 看到的都是同一个值。
      const opts: BenchInitOptions = { ...raw, scene: raw.scene ?? defaultScene }
      await api.reset()
      frameLoop.setBlocking(opts.manualClock)
      const canvas = document.createElement('canvas')
      canvas.style.width = `${opts.width}px`
      canvas.style.height = `${opts.height}px`
      document.body.appendChild(canvas)
      const textures = await makeTextures(opts)
      const scene = await makeScene(opts, canvas, textures.textures)
      session = { opts, canvas, scene, textures, white: createWhiteTexture() }
      // 预热已经在场景内部做完了，这里把计数器清零，之后数到的就都是剧本自己产生的。
      glCounters.reset()
    },

    async run(name, options) {
      const current = need()
      const scenario = SCENARIOS[name]
      if (!scenario) throw new Error(`没有这段剧本：${name}`)
      segment = name
      frames = []
      peakOverdraw = null
      overdrawSamples = 0
      const ctx = createContext(current.scene, driver())

      recording = false
      await scenario.setup?.(ctx)

      recording = options?.record !== false
      phase = 'action'
      glCounters.reset()
      await scenario.run(ctx)

      phase = 'idle'
      await runIdle(driver(), current.opts.idleFrames ?? DEFAULT_IDLE_FRAMES)
      recording = false
    },

    metrics() {
      const current = need()
      return {
        profile: current.opts.profile,
        segment,
        tier: current.opts.tier,
        width: current.opts.width,
        height: current.opts.height,
        resolution: current.opts.resolution,
        seed: current.opts.seed,
        summary: summarize(segment, frames),
        frames,
      }
    },

    /**
     * 取剧本期间采到的最大值和「此刻」这一次里更大的那个。
     *
     * 只看结束时的画面是不够的：命中特效和全屏发光在剧本中途才叠起来，
     * 跑完就已经收掉了，那一刻才是这条指标真正要拦的情况。
     */
    overdraw() {
      const now = measureNow()
      if (peakOverdraw && peakOverdraw.average > now.average) return peakOverdraw
      return now
    },

    async reset() {
      if (!session) return
      const { scene, textures, white, canvas } = session
      session = null
      scene.destroy()
      // 纹理归页面所有（契约里是传给场景的），场景不会替我们销毁。
      // 不还回去的话它们留在显存里，泄漏那条检查会看到常驻纹理内存回不到基线。
      await textures.dispose()
      white.destroy(true)
      canvas.remove()
      frames = []
    },

    async deal() {
      const current = need()
      await createContext(current.scene, driver()).act(() => current.scene.restart())
    },

    async play(count) {
      const current = need()
      await createContext(current.scene, driver()).act(() => current.scene.playCards(count))
    },

    async settle() {
      await createContext(need().scene, driver()).settle()
    },

    async keyframes(name, stops) {
      const current = need()
      const scenario = SCENARIOS[name]
      if (!scenario) throw new Error(`没有这段剧本：${name}`)
      // 关掉逐帧记录：这一趟只为了抓图，记下来的帧没人读，白白每帧建几个对象。
      recording = false
      return captureKeyframes({
        scenario,
        stops,
        driver: driver(),
        context: (gated) => createContext(current.scene, gated),
        grab: () => grabFrame(probe, current.opts.width, current.opts.height),
      })
    },

    commands: () => need().scene.commands(),
    handCards: () => need().scene.handCards(),
    hitPoints: (prefix) => probe.pointsOf(prefix),

    segments: () => Object.keys(SCENARIOS),
    counters: () => glCounters.snapshot(),
    contextSeen: () => glCounters.contextSeen(),
    enableGpuTiming() {
      const gl = need().canvas.getContext('webgl2')
      return gl ? probe.enableGpuTiming(gl) : false
    },
    gpu() {
      const samples = probe.gpuSamplesMs()
      if (samples.length === 0) {
        return { available: false, reason: probe.gpuReason() ?? '没有采到样本' }
      }
      return {
        available: true,
        averageMs: samples.reduce((a, b) => a + b, 0) / samples.length,
      }
    },
  }
  return api
}
