/**
 * `window.__bench`：Playwright 从 Node 那边操纵页面的唯一入口。
 *
 * 一次测量的顺序固定是 init → run → metrics / overdraw → reset。
 * setup 阶段的帧不记录：它只是把场景摆到被测动作开始前的样子，混进去会污染峰值。
 */

import { diffCounters, diffScene, summarize } from '../metrics/diff'
import type { FrameLoopHandle } from '../metrics/frameLoop'
import type { GlCounterHandle } from '../metrics/glCounters'
import type { BenchMetrics, FrameRecord, GlCounters, OverdrawResult } from '../metrics/types'
import type { FrameDriver } from '../scenarios/index'
import { createContext, FRAME_MS, runIdle, SCENARIOS } from '../scenarios/index'
import type { AtlasOptions } from '../scene/atlas'
import { DEFAULT_ATLAS } from '../scene/atlas'
import type { BenchScene, CardTextures, DuelCommand, EffectTier } from '../scene/contract'
import { createDuelSession } from '../scene/duelSession'
import { createStubDuelScene } from '../scene/stubScene'
import type { LoadedTextures } from '../scene/textures'
import { createProceduralTextures, createWhiteTexture, loadAtlasTextures } from '../scene/textures'
import { grabFrame } from './grabFrame'
import type { HitPoint } from './hitPoints'
import { hitPointsOf } from './hitPoints'
import type { KeyframeShots } from './keyframes'
import { captureKeyframes } from './keyframes'
import { measureOverdraw } from './overdraw'
import type { RenderProbe } from './renderProbe'

export type SceneKind = 'stub' | 'duel'

export interface BenchInitOptions {
  profile: string
  width: number
  height: number
  resolution: number
  tier: EffectTier
  seed: number
  deck: string[]
  manualClock: boolean
  /**
   * 测哪个场景。默认 'duel'，也就是 canvas 包的真实对局场景——6.9 的指标要的是它的数字。
   * 'stub' 是 bench 自带的桩场景，只在自测测量骨架时用（见 scene/stubScene.ts）。
   */
  scene?: SceneKind
  /** 传了就从图集加载纹理，不传就按场景挑默认：真实场景用图集，桩场景用程序生成的纯色卡面。 */
  atlas?: AtlasOptions
  /** 剧本跑完之后空转多少帧，用来验证帧循环停了。 */
  idleFrames?: number
  /** 每隔多少帧采一次过度绘制，0 表示只在剧本结束后采一次。 */
  overdrawSampleEvery?: number
  /**
   * 这一局用哪副牌组。不给就用剧本自己那副。
   * 只有交互用例会传（它要摸到一张技能牌），理由见 scene/duelScript.ts。
   */
  duelDeck?: string[]
  /**
   * 我方这一端选哪位英雄。不给就是不选英雄。
   * 同样只有交互用例会传（它要按到侧栏那颗「发动」钮），理由见 scene/contract.ts 的 `hero`。
   */
  duelHero?: string
}

export interface GpuReport {
  available: boolean
  averageMs?: number
  reason?: string
}

interface RunOptions {
  /**
   * false 时不记录逐帧数据，也不采过度绘制。
   *
   * 堆采样要用这一档：逐帧记录本身每帧要建好几个对象，
   * 混进采样里量到的是测量骨架而不是场景，短剧本上骨架的那一份还会占大头。
   */
  record?: boolean
}

export interface BenchApi {
  init(opts: BenchInitOptions): Promise<void>
  run(segment: string, options?: RunOptions): Promise<void>
  /**
   * 开一局，并把开局那段演出（抛硬币、发牌）推完。
   *
   * 交互用例用它把画面摆到「手牌就在屏幕上、锁也放开了」那一刻，之后才轮到真指针上场。
   * 和 `run('deal')` 的区别是不热身、不记指标——那两样是给性能剧本的。
   */
  deal(): Promise<void>
  /**
   * 照脚本打出 n 张牌，把局面推到「场上真有单位」那一步。
   *
   * 交互用例里的英雄技能要有目标才按得动，而它自己用真指针打出的那一下**不会真的执行**
   *（场景发出来的指令在这里只记账，见 scene/duelSession.ts），所以场上的单位只能由脚本摆。
   * 和 `run('play10')` 的区别同 `deal`：不热身、不记指标。
   */
  play(count: number): Promise<void>
  /**
   * 一直推到场景闲下来。
   *
   * 手动时钟下没人替我们推帧，而真指针那几下之间是有演出要演的（牌飞出去、目标层立起来）。
   * 推不完（演出卡住了）会抛，不会静悄悄地挂着。
   */
  settle(): Promise<void>
  /** 场景自 init 以来发出的指令。交互用例断言的就是这张表。 */
  commands(): readonly DuelCommand[]
  /** 我方此刻的手牌。交互用例靠它认出哪一张是技能牌。 */
  handCards(): readonly { instanceId: string; cardId: string }[]
  /**
   * 场景图里 label 以 `prefix` 开头的对象，各给一个点得到的视口坐标。
   * 卡是 `card:<实例 id>`、战场格子是 `tile:<实例 id>`（见各组件的构造函数），
   * 「结束出牌」是 `button:end-play`（在 canvas 的 scenes/duel/parts.ts 上）。
   */
  hitPoints(prefix: string): HitPoint[]
  /**
   * 跑一段剧本，在指定的**帧号**上各抓一张画面。截图回归（6.6）用。
   *
   * 帧号从被测动作的第一帧算起（热身那一遍不计），和指标那边的口径一致。
   * **抓齐最后一张就收工**，不把剧本跑完——最长那一段（play10）一遍是一千五百多帧，
   * 而关键帧都排在前几百帧里，跑完剩下的只是白等。
   * 帧号排到剧本长度之外时抓到的图会比要的少，调用方据此报错。
   */
  keyframes(segment: string, stops: number[]): Promise<KeyframeShots>
  metrics(): BenchMetrics
  overdraw(): OverdrawResult
  reset(): Promise<void>
  segments(): string[]
  /** 当前的累计计数器快照。泄漏检查靠它读常驻纹理内存。 */
  counters(): GlCounters
  /** 计数器有没有真的接管到 WebGL 上下文。为 false 时下面所有数字都不可信。 */
  contextSeen(): boolean
  enableGpuTiming(): boolean
  gpu(): GpuReport
}

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
  const atlas = opts.atlas ?? (opts.scene === 'duel' ? DEFAULT_ATLAS : undefined)
  if (atlas) return loadAtlasTextures(opts.deck, atlas)
  return createProceduralTextures(opts.deck)
}

async function makeScene(
  opts: BenchInitOptions,
  canvas: HTMLCanvasElement,
  textures: CardTextures,
): Promise<BenchScene> {
  const create = opts.scene === 'duel' ? createDuelSession : createStubDuelScene
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
        // 真实时钟：帧由场景自己的 ticker 推，这里只是等一帧过去再取快照。
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        record(() => {})
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
    hitPoints: (prefix) => hitPointsOf(probe, prefix),

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
