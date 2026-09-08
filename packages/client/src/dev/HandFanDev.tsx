/**
 * 开发专用页面：手牌扇形、拖出出牌、翻面、命中特效（迁移第 1 条）。
 * 地址 `/dev/hand-fan`，挂载点见 App.tsx。生产构建里不存在这个文件的代码，理由见 index.ts。
 *
 * 页面自己负责三件画布场景不管的事：加载图集、算视口大小、封顶渲染倍率。
 * 场景只收"已经准备好的纹理"和一个像素尺寸——资源从哪来、屏幕多大是装配层的事
 * （见《正式版架构》第 2 节第 5 条，将来这几件都走 platform 包）。
 */

import { createDuelPrototype, type DuelPrototype, type EffectTier } from '@ai-duel/canvas'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadCardAtlas } from './cardAtlas'
// 设计令牌的 CSS 变量，下面那份样式表要用。真正的界面开始做之后（迁移第 31 条）
// 这一行搬到 App.tsx 去引一次就够，现在只有开发页用得上，没必要让生产包跟着带。
import '@ai-duel/design/tokens.css'
import './handFanDev.css'

/**
 * 渲染倍率封顶（纪律 3.3）：设备像素比最高按 1.5 渲染，4K 屏不按 2 倍。
 * 低端档降到 0.75 的那条留给效果分档接进来之后再做。
 */
const MAX_RESOLUTION = 1.5

/** 开局发几张。和 core 的开局手牌数一致，正好也是扇形排布最有代表性的张数。 */
const DEAL_COUNT = 5

/** 剧本里所有随机（烟尘方向、大小）用的种子。写死是为了每次打开看到的都是同一套演出。 */
const SEED = 20260905

/**
 * 计数器和帧率的采样间隔（毫秒）。
 *
 * 500ms 是个折中：短了 React 重渲染太频繁（那本身就会影响要量的东西），
 * 长了帧率反应不过来——一次 hover 抬牌只演零点几秒，采样窗口比它还长就永远看不到峰值。
 */
const SAMPLE_MS = 500

/**
 * 算帧率时最多留几个采样窗口的历史。
 * 只在最新窗口跑得太短、要往回借时间摊平噪声时才会用到更早的那几个（见 frameRate）。
 */
const FPS_WINDOW_SAMPLES = 3

/**
 * 算一次帧率至少要攒够多少毫秒的「循环在跑」的时间，不够就往回再借一个窗口。
 * 一个窗口里只跑了两三帧时分子分母都是个位数，差一帧数字就能跳好几十。
 */
const MIN_ACTIVE_MS = 100

/** 面板的初始值，也是场景还没起来／已经拆掉时的兜底。 */
const ZERO_COUNTERS = { textCreated: 0, renders: 0, frameRequests: 0, activeMs: 0 }

/** 一个采样窗口里的增量。 */
interface FpsSample {
  renders: number
  activeMs: number
}

/**
 * 从最近几个采样窗口算每秒渲染帧数；返回 null 表示帧循环这段时间根本没跑（显示「空闲」）。
 *
 * 分母是帧循环**真正在跑**的时间（activeMs），不是墙钟时间。没有动画时循环会整个停下
 * （纪律 3.6），拿墙钟当分母的话，窗口里只要夹着一段空闲，帧率就被摊薄——
 * 动画刚停下的那个窗口会显示十几帧，而它渲染的那两百毫秒其实是满帧，越空闲数字越难看，
 * 和直觉正好相反。
 *
 * 「在不在跑」只看最新那个窗口，「跑多快」才允许往回借时间：
 * 借来的只是分母里的运行时间（空闲那段本来就不在 activeMs 里），摊平的是短窗口的噪声，
 * 不会让一个已经停下的循环继续报帧率。
 */
function frameRate(history: FpsSample[]): number | null {
  const latest = history[history.length - 1]
  // 最新窗口里循环一帧都没跑：现在就是空闲。不去翻更早的窗口硬凑一个数字出来——
  // 「没动画就停掉帧循环」（3.6）得在画面上看得见。
  if (latest === undefined || latest.activeMs <= 0) return null
  let renders = latest.renders
  let activeMs = latest.activeMs
  for (let i = history.length - 2; i >= 0 && activeMs < MIN_ACTIVE_MS; i -= 1) {
    const sample = history[i]
    if (sample === undefined) break
    renders += sample.renders
    activeMs += sample.activeMs
  }
  return Math.round((renders * 1000) / activeMs)
}

const TIERS: EffectTier[] = ['low', 'mid', 'high']

export function HandFanDev() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<DuelPrototype | null>(null)
  const [tier, setTier] = useState<EffectTier>('mid')
  const [status, setStatus] = useState('正在加载图集…')
  const [counters, setCounters] = useState(ZERO_COUNTERS)
  /** 最近几个采样窗口里的每秒渲染帧数；null 表示帧循环已经停了，显示成「空闲」。 */
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (host === null || canvas === null) return

    let disposed = false

    const boot = async () => {
      const textures = await loadCardAtlas()
      if (disposed) return
      const rect = host.getBoundingClientRect()
      const scene = await createDuelPrototype({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(window.devicePixelRatio, MAX_RESOLUTION),
        tier,
        seed: SEED,
        textures,
        deck: Object.keys(textures.faces),
        // 开发页要用真鼠标拖牌，所以走真实时钟。没有动画时帧循环仍然会自己停（3.6）。
        manualClock: false,
      })
      if (disposed) {
        scene.destroy()
        return
      }
      sceneRef.current = scene
      setStatus('就绪：拖一张牌到上半屏就是出牌')
      await scene.deal(DEAL_COUNT)
    }

    boot().catch((error: unknown) => {
      setStatus(`起不来：${error instanceof Error ? error.message : String(error)}`)
    })

    // 视口跟着容器走，桌面和手机两档都按各自的比例排版（需求第 3 条）。
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      sceneRef.current?.resize(width, height)
    })
    observer.observe(host)

    /*
     * 清理只拆一次。
     *
     * 以前这里既拆 sceneRef.current 又拆闭包里那份局部引用，而两者是同一个对象：
     * 第二次 destroy 进到 Pixi 的 renderer.destroy 里就在已经置空的表上取属性，
     * 抛 TypeError，异常从 effect 清理冒出去，React 把整个组件卸载——表现就是切档位后白屏。
     * 场景那边现在也自己挡了重复调用，两头都堵上：契约没规定「只许拆一次」。
     * 拆完把 ref 清掉，轮询计数器那个 effect 才不会去问一个已经没了的场景。
     */
    return () => {
      disposed = true
      observer.disconnect()
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
    // tier 变了要整个重建场景：档位决定粒子池大小和特效开关，都是建场景时定下的。
  }, [tier])

  /*
   * 计数器是给性能纪律看的（3.5 的文字、3.6 的空闲帧循环），
   * 用轮询而不是每帧回调：每帧往 React 里塞一次状态本身就会把帧循环钉住不放。
   *
   * 帧率也从这里算，而不是页面自己开一个 rAF 去数：
   * 页面开了 rAF 就等于给自己上了一个永不停的帧循环，「没动画时停掉帧循环」（3.6）
   * 这条从此在画面上看不出来了——真停了还是没停，帧率都照样显示六十几。
   * 现在数的是场景自己的渲染次数（renders），除以场景自己记的运行时间（activeMs），
   * 场景不画就显示「空闲」，一眼看得出它停了；而它在画的时候数字是真实帧率，
   * 不会被同一个窗口里的空闲拖低（见 frameRate）。
   */
  useEffect(() => {
    /** 上一次采样是在哪个场景上取的。换档位会换一个新场景，计数器从头数，不能跨着相减。 */
    let sampled: DuelPrototype | null = null
    let last = ZERO_COUNTERS
    /** 最近几个窗口的增量，最新的在末尾。只留 FPS_WINDOW_SAMPLES 个。 */
    const history: FpsSample[] = []
    const timer = window.setInterval(() => {
      const scene = sceneRef.current
      if (scene === null || scene !== sampled) {
        // 场景没了或者换了一个：把基线对到现在，历史清掉（跨场景相减没有意义）。
        sampled = scene
        const fresh = scene?.counters() ?? ZERO_COUNTERS
        last = fresh
        history.length = 0
        setCounters(fresh)
        setFps(null)
        return
      }
      const next = scene.counters()
      history.push({
        renders: next.renders - last.renders,
        activeMs: next.activeMs - last.activeMs,
      })
      if (history.length > FPS_WINDOW_SAMPLES) history.shift()
      last = next
      setCounters(next)
      setFps(frameRate(history))
    }, SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [])

  const run = useCallback((action: (scene: DuelPrototype) => void) => {
    const scene = sceneRef.current
    if (scene !== null) action(scene)
  }, [])

  return (
    <div className="hand-fan-dev">
      <div className="hand-fan-dev__stage" ref={hostRef}>
        {/*
          key 挂 tier：换档位时让 React 换一个全新的 <canvas>，而不是在旧的上面重建场景。
          Pixi 的 renderer.destroy() 最后会调 WEBGL_lose_context.loseContext()，
          把这个 canvas 的 WebGL 上下文永久丢掉；同一个元素上再取上下文拿到的还是那个已丢的，
          新场景画不出东西（实测还会把页面卡住）。canvas 元素本身很便宜，换一个最省事。
        */}
        <canvas key={tier} ref={canvasRef} />
        {/* 帧率贴在画布左上角。半透明小字，盖不住手牌那片。 */}
        <span className="hand-fan-dev__fps">{fps === null ? '空闲' : `${fps} fps`}</span>
      </div>
      <div className="hand-fan-dev__panel">
        <button type="button" onClick={() => run((s) => void s.deal(1))}>
          发一张
        </button>
        <button type="button" onClick={() => run((s) => void s.deal(DEAL_COUNT))}>
          发 {DEAL_COUNT} 张
        </button>
        <button type="button" onClick={() => run((s) => void s.playCard(0))}>
          出第一张
        </button>
        <button type="button" onClick={() => run((s) => void s.flip(0))}>
          翻第一张
        </button>
        <button type="button" onClick={() => run((s) => s.hover(0))}>
          抬起第一张
        </button>
        <button type="button" onClick={() => run((s) => s.hover(null))}>
          收回
        </button>
        <span className="hand-fan-dev__group">
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
        <span className="hand-fan-dev__status">{status}</span>
        <span className="hand-fan-dev__counters">
          文字 {counters.textCreated} · 渲染 {counters.renders} · 帧回调 {counters.frameRequests}
        </span>
      </div>
    </div>
  )
}
