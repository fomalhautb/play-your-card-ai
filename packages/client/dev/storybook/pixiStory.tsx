/**
 * 把一个 Pixi 组件嵌进组件目录页的通用包装（《正式版架构》7.1 第 3 条：
 * 「React 部分用 Storybook，Pixi 组件在同一目录页里嵌画布展示」）。
 *
 * 分工：这里只负责**舞台**——建渲染器、建帧循环、加载图集、按参数重建、收尾清理；
 * 画什么由每条 story 自己的 `mount(ctx)` 决定，那段演示代码写在 story 文件里，
 * 不进组件本身（组件不该为了被展示而多一个方法）。
 *
 * 默认走**手动时钟**：挂载完之后按固定步长推进到一个固定时刻再交出画面，
 * 同一条 story 每次打开都停在同一帧，截图回归才比得动（6.6「固定步进时钟」）。
 * 想看动画就在控制面板里打开「实时」，那一档换成真实 ticker，不做任何步进。
 */

import { Animator, FrameLoop, type StoryStage, type StoryTeardown } from '@ai-duel/canvas'
import { tokens } from '@ai-duel/design'
import { autoDetectRenderer, Container } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { loadCardAtlas } from '../../src/dev/cardAtlas'

/** 手动时钟的步长：60fps 那一档。写死才有确定性——按真实帧间隔推每次结果都不一样。 */
const STEP_MS = 1000 / 60

/**
 * 渲染倍率封顶（纪律 3.3），和开发页同一个数。
 *
 * 截图回归那边把浏览器的 deviceScaleFactor 钉在 1（见 playwright.config.ts），
 * 所以基线图永远是按 1 倍烤的；这里跟着 devicePixelRatio 走只影响人在高分屏上看目录页，
 * 不影响比对。
 */
const MAX_RESOLUTION = 1.5

/** 画布默认尺寸，单张卡那种小场面够用；摆得开的 story 自己在 spec 里放大。 */
const DEFAULT_SIZE = { width: 360, height: 420 }

/**
 * 一条 Pixi story 的声明。放在 story 的 `parameters.pixi` 里，由 preview 的装饰器认出来。
 * `mount` 拿到的舞台长什么样，见 `@ai-duel/canvas` 导出的 StoryStage——
 * 那份类型放在 canvas 包里，两头照着同一份写（理由见 storyStage.ts 的文件头）。
 */
export interface PixiStorySpec {
  /** 往舞台上摆东西。返回一个清理函数（story 自己建的纹理要自己收）。 */
  mount(ctx: StoryStage): StoryTeardown | Promise<StoryTeardown>
  width?: number
  height?: number
  /** 手动时钟下要推进到的时刻（毫秒）。动画类 story 靠它停在固定的一帧。 */
  settleMs?: number
  /** 要不要卡面图集。要而图集不在时，画布位置显示一句提示而不是白屏。 */
  needsAtlas?: boolean
}

interface PixiStageProps {
  spec: PixiStorySpec
  /** 真实时钟：不做步进，交给 rAF 自己跑，用来看动画。 */
  live: boolean
}

/** 舞台建到哪一步了。图集缺失和建场景失败都停在 'failed'，画面上给一句话。 */
type Phase = 'building' | 'ready' | 'failed'

/**
 * 一个条目的画布。
 *
 * 重建整个场景（换档位、重播）由调用方给不同的 `key` 来做，不在这里另设一个计数器：
 * Pixi 的 `renderer.destroy()` 会把画布的 WebGL 上下文**永久**丢掉，同一个 `<canvas>`
 * 元素上再取上下文拿到的还是那个已丢的，新场景画不出东西（开发页踩过同一个坑）。
 * 换 key 让 React 连这个组件带里面的 canvas 一起换掉，最省事。
 */
export function PixiStage({ spec, live }: PixiStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('building')
  const [problem, setProblem] = useState('')
  const width = spec.width ?? DEFAULT_SIZE.width
  const height = spec.height ?? DEFAULT_SIZE.height

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    setPhase('building')
    setProblem('')

    let disposed = false
    let teardown: (() => void) | null = null

    const boot = async () => {
      const textures = spec.needsAtlas === true ? await loadCardAtlas() : null
      if (disposed) return

      const renderer = await autoDetectRenderer({
        canvas,
        width,
        height,
        resolution: Math.min(window.devicePixelRatio, MAX_RESOLUTION),
        // 3.8：显式走 WebGL，不试 WebGPU。目录页和真场景必须是同一条渲染路径。
        preference: ['webgl'],
        antialias: true,
        autoDensity: true,
        background: tokens.color.page.background,
        /*
         * 画完一帧之后保留后备缓冲。真场景里不开这个（多一次拷贝），目录页必须开：
         * 截图回归拍整页时浏览器会重新合成一次，而 WebGL 画布默认在合成后就把缓冲清掉了，
         * 拍出来是一块空白。这是目录页这个"取景台"自己的需要，不改组件的任何行为。
         */
        preserveDrawingBuffer: true,
      })
      if (disposed) {
        renderer.destroy()
        return
      }

      const stage = new Container()
      const frameHooks: ((deltaMs: number) => boolean)[] = []
      /** 上一帧的逐帧跟随还没收敛。和补间账一起决定帧循环停不停（3.6）。 */
      let hooksBusy = false
      let loop: FrameLoop | null = null
      const animator = new Animator(() => loop?.wake())
      loop = new FrameLoop({
        manual: !live,
        render: (deltaMs) => {
          let busy = false
          for (const hook of frameHooks) {
            if (hook(deltaMs)) busy = true
          }
          hooksBusy = busy
          renderer.render(stage)
        },
        isBusy: () => animator.isBusy() || hooksBusy,
      })

      const ctx: StoryStage = {
        stage,
        renderer,
        animator,
        resolution: renderer.resolution,
        width,
        height,
        textures,
        step: (deltaMs) => loop?.step(deltaMs),
        onFrame: (advance) => frameHooks.push(advance),
      }
      const mounted = await spec.mount(ctx)
      teardown = () => {
        if (typeof mounted === 'function') mounted()
        loop?.destroy()
        animator.destroy()
        // 只收场景自己建的东西：图集纹理是 loadCardAtlas 加载的，归 Pixi 的 Assets 管。
        stage.destroy({ children: true, texture: false, textureSource: false })
        renderer.destroy()
      }
      if (disposed) return

      if (live) {
        loop.wake()
      } else {
        // 先画一帧保底（一张静态图的 story 没有任何补间，推多少步都不会触发渲染），
        // 再按固定步长推到 settleMs。步数取整，同一条 story 每次都是同样多帧。
        loop.step(0)
        const steps = Math.round((spec.settleMs ?? 0) / STEP_MS)
        for (let i = 0; i < steps; i += 1) loop.step(STEP_MS)
      }
      setPhase('ready')
    }

    boot().catch((error: unknown) => {
      if (disposed) return
      setProblem(error instanceof Error ? error.message : String(error))
      setPhase('failed')
    })

    return () => {
      disposed = true
      teardown?.()
      teardown = null
    }
  }, [spec, live, width, height])

  return (
    <div
      // 截图回归拿这个属性当「这一帧可以拍了」的信号，见 catalog.spec.ts。
      // 失败也算就绪：那时画面上是一句提示，拍下来一样是稳定的。
      data-story-ready={phase === 'building' ? undefined : '1'}
      style={{ width, height, position: 'relative' }}
    >
      <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
      {phase === 'failed' && <StageProblem message={problem} width={width} height={height} />}
    </div>
  )
}

/**
 * 建不起来时盖在画布上的提示。
 *
 * 最常见的一种是图集还没打：卡面图集是 `pnpm assets:build` 的产物、不进仓库，
 * 刚 clone 完的仓库里没有它，加载会 404。不给提示的话这里就是一块纯色，
 * 看着像组件坏了。
 */
function StageProblem({
  message,
  width,
  height,
}: {
  message: string
  width: number
  height: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.sm,
        alignItems: 'center',
        justifyContent: 'center',
        padding: tokens.space.xxl,
        boxSizing: 'border-box',
        textAlign: 'center',
        color: tokens.color.page.foreground,
        fontFamily: tokens.font.family.serif,
        fontSize: tokens.font.size.base,
        lineHeight: 1.6,
      }}
    >
      <strong>这条条目起不来</strong>
      <span>{message}</span>
      <span style={{ opacity: 0.7 }}>卡面图集是构建产物，先跑一次 pnpm assets:build。</span>
    </div>
  )
}
