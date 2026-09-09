/**
 * 开发专用页面：本地打一整局（迁移第 18 条）。
 * 地址 `/dev/duel`，挂载点见 App.tsx。生产构建里不存在这个文件的代码，理由见 App.tsx。
 *
 * 页面负责三件画布场景不管的事：加载图集、算视口大小、封顶渲染倍率；外加**推时钟**——
 * 场景走手动时钟，编排层的虚拟时钟和场景的帧由这一个 rAF 一起推。
 * 一条循环而不是两条，是因为两边的时刻必须严格对齐：编排层排在第 3540 毫秒的那条 cue，
 * 场景要在同一刻播（见 canvas 的 scenes/duel/clock.ts）。
 *
 * 真 driver（第 21 条）落地后这一页会跟着换掉：那时推时钟的是 driver，不是页面。
 */

import { createDuelScene, type DuelScene, type EffectTier } from '@ai-duel/canvas'
import { createCatalog } from '@ai-duel/content'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadCardAtlas } from './cardAtlas'
import { createLocalDuel, type LocalDuel } from './localDuel'
// 设计令牌的 CSS 变量，下面那份样式表要用。真正的界面开始做之后（迁移第 31 条）
// 这一行搬到 App.tsx 去引一次就够，现在只有开发页用得上，没必要让生产包跟着带。
import '@ai-duel/design/tokens.css'
import './duelDev.css'

/**
 * 渲染倍率封顶（纪律 3.3）：设备像素比最高按 1.5 渲染，4K 屏不按 2 倍。
 * 低端档降到 0.75 的那条留给效果分档接进来之后再做。
 */
const MAX_RESOLUTION = 1.5

/** 这一局的种子。写死是为了每次打开看到的都是同一副牌、同一套演出。 */
const SEED = 20260905

/** 计数器和帧率的采样间隔（毫秒）。短了 React 重渲染太频繁，长了看不到峰值。 */
const SAMPLE_MS = 500

/** 一帧最多推多久：标签页切回来时两次 rAF 能差好几秒，照实喂进去演出会一口气跳完。 */
const MAX_FRAME_MS = 100

const ZERO_COUNTERS = { textCreated: 0, renders: 0, frameRequests: 0, activeMs: 0 }

const TIERS: EffectTier[] = ['low', 'mid', 'high']

export function DuelDev() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<DuelScene | null>(null)
  const duelRef = useRef<LocalDuel | null>(null)
  const [tier, setTier] = useState<EffectTier>('mid')
  const [status, setStatus] = useState('正在加载图集…')
  const [counters, setCounters] = useState(ZERO_COUNTERS)
  /** 渲染帧率；null 表示这一段里场景一帧都没画（也就是纪律 3.6 里的「停了」）。 */
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (host === null || canvas === null) return

    let disposed = false
    let raf = 0
    let last = 0

    const boot = async () => {
      const textures = await loadCardAtlas()
      if (disposed) return
      const rect = host.getBoundingClientRect()
      const scene = await createDuelScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(window.devicePixelRatio, MAX_RESOLUTION),
        tier,
        seat: 0,
        textures,
        catalog: createCatalog(),
        seed: SEED,
        // 时钟归这一页推，见文件头。
        manualClock: true,
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      })
      if (disposed) {
        scene.destroy()
        return
      }
      const duel = createLocalDuel(scene, SEED)
      scene.onCommand((command) => duel.command(command))
      // 用户操作只喂编排层：演出和锁归它管，指令是另一条路（见 localDuel 的文件头）。
      scene.onUserAction(() => undefined)
      scene.onTutorialCue(() => undefined)
      sceneRef.current = scene
      duelRef.current = duel

      const frame = (stamp: number) => {
        raf = window.requestAnimationFrame(frame)
        const deltaMs = last === 0 ? 0 : Math.min(MAX_FRAME_MS, stamp - last)
        last = stamp
        if (deltaMs <= 0) return
        duel.step(deltaMs)
        scene.step(deltaMs)
      }
      raf = window.requestAnimationFrame(frame)
      setStatus('把牌拖到上半屏就是出牌')
    }

    boot().catch((error: unknown) => {
      setStatus(`起不来：${error instanceof Error ? error.message : String(error)}`)
    })

    // 视口跟着容器走，桌面和手机两档各按各的版式排（需求第 3 条）。
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      sceneRef.current?.resize(width, height)
    })
    observer.observe(host)

    /*
     * 清理只拆一次。场景那边也自己挡了重复调用——以前这里拆两次会在 Pixi 内部
     * 已经置空的表上取属性，异常从 effect 清理冒出去，表现是切档位后整页白屏。
     */
    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      observer.disconnect()
      sceneRef.current?.destroy()
      sceneRef.current = null
      duelRef.current = null
    }
    // tier 变了要整个重建场景：档位决定粒子池大小和特效开关，都是建场景时定下的。
  }, [tier])

  /*
   * 计数器和帧率轮询着读，不每帧塞进 React——那本身就会把帧循环钉住不放。
   *
   * 帧率的分母用墙钟、分子用场景自报的渲染次数：手动时钟下场景不记 activeMs
   *（那是墙钟量，对固定步进没有意义），而这一页的时钟正是墙钟。
   * 场景没在画的时候分子是 0，显示「空闲」——「没动画就停掉帧循环」（3.6）因此在画面上看得见。
   */
  useEffect(() => {
    let sampled: DuelScene | null = null
    let previous = ZERO_COUNTERS
    let stamp = performance.now()
    const timer = window.setInterval(() => {
      const scene = sceneRef.current
      const now = performance.now()
      if (scene === null || scene !== sampled) {
        sampled = scene
        previous = scene?.counters() ?? ZERO_COUNTERS
        stamp = now
        setCounters(previous)
        setFps(null)
        return
      }
      const next = scene.counters()
      const renders = next.renders - previous.renders
      const elapsed = now - stamp
      previous = next
      stamp = now
      setCounters(next)
      setFps(renders === 0 || elapsed <= 0 ? null : Math.round((renders * 1000) / elapsed))
      setStatus(duelRef.current?.status() ?? '')
    }, SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [])

  const restart = useCallback(() => {
    const scene = sceneRef.current
    if (scene === null) return
    scene.reset()
    duelRef.current = createLocalDuel(scene, SEED)
    scene.onCommand((command) => duelRef.current?.command(command))
  }, [])

  return (
    <div className="duel-dev">
      <div className="duel-dev__stage" ref={hostRef}>
        {/*
          key 挂 tier：换档位时让 React 换一个全新的 <canvas>，而不是在旧的上面重建场景。
          Pixi 的 renderer.destroy() 会把这个 canvas 的 WebGL 上下文永久丢掉，
          同一个元素上再取上下文拿到的还是那个已丢的，新场景画不出东西。
        */}
        <canvas key={tier} ref={canvasRef} />
        <span className="duel-dev__fps">{fps === null ? '空闲' : `${fps} fps`}</span>
      </div>
      <div className="duel-dev__panel">
        <button type="button" onClick={restart}>
          重开一局
        </button>
        <span className="duel-dev__group">
          档位
          {TIERS.map((value) => (
            <button
              key={value}
              type="button"
              data-active={value === tier}
              onClick={() => setTier(value)}
            >
              {value}
            </button>
          ))}
        </span>
        <span className="duel-dev__status">{status}</span>
        <span className="duel-dev__counters">
          文字 {counters.textCreated} · 渲染 {counters.renders}
        </span>
      </div>
    </div>
  )
}
