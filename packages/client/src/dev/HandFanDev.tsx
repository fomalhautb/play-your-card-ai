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

const TIERS: EffectTier[] = ['low', 'mid', 'high']

export function HandFanDev() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<DuelPrototype | null>(null)
  const [tier, setTier] = useState<EffectTier>('mid')
  const [status, setStatus] = useState('正在加载图集…')
  const [counters, setCounters] = useState({ textCreated: 0, renders: 0, frameRequests: 0 })

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (host === null || canvas === null) return

    let disposed = false
    let scene: DuelPrototype | null = null

    const boot = async () => {
      const textures = await loadCardAtlas()
      if (disposed) return
      const rect = host.getBoundingClientRect()
      scene = await createDuelPrototype({
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

    return () => {
      disposed = true
      observer.disconnect()
      sceneRef.current?.destroy()
      sceneRef.current = null
      scene?.destroy()
    }
    // tier 变了要整个重建场景：档位决定粒子池大小和特效开关，都是建场景时定下的。
  }, [tier])

  // 计数器是给性能纪律看的（3.5 的文字、3.6 的空闲帧循环），
  // 用轮询而不是每帧回调：每帧往 React 里塞一次状态本身就会把帧循环钉住不放。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const scene = sceneRef.current
      if (scene !== null) setCounters(scene.counters())
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  const run = useCallback((action: (scene: DuelPrototype) => void) => {
    const scene = sceneRef.current
    if (scene !== null) action(scene)
  }, [])

  return (
    <div className="hand-fan-dev">
      <div className="hand-fan-dev__stage" ref={hostRef}>
        <canvas ref={canvasRef} />
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
