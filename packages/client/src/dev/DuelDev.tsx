/**
 * 开发专用页面：本地开一局，边打边看效果档位和渲染计数。
 * 地址 `/dev/duel`，挂载点见 App.tsx。生产构建里不存在这个文件的代码，理由见 App.tsx。
 *
 * 这一页和正式的 `/match` 用的是**同一条链**（`createTestMatch` → `DuelStage`），
 * 只多两样正式界面不该有的东西：现场切效果档位，以及每半秒读一次场景的计数器。
 * 第 18 条那版自己搭了一套引擎和对手（`localDuel.ts`），真 driver 落地之后那份删掉了——
 * 两套接线并存的话，这一页看到的行为就不再等于玩家看到的行为，调试也就失去意义。
 */

import type { DuelScene, EffectTier } from '@ai-duel/canvas'
import { Button } from '@ai-duel/ui'
import { useEffect, useRef, useState } from 'react'
import { usePlatform } from '../app/platform'
import type { LocalDriver } from '../match/localDriver'
import { createTestMatch } from '../match/localMatch'
import { DuelStage } from '../screens/DuelStage'
import { DevPanel } from './DevPanel'
import './duelDev.css'

/** 这一局的种子。写死是为了每次打开看到的都是同一副牌、同一套演出。 */
const SEED = 20260905

/** 计数器和帧率的采样间隔（毫秒）。短了 React 重渲染太频繁，长了看不到峰值。 */
const SAMPLE_MS = 500

const ZERO_COUNTERS = { textCreated: 0, renders: 0, frameRequests: 0, activeMs: 0 }

const TIERS: EffectTier[] = ['low', 'mid', 'high']

export function DuelDev() {
  const platform = usePlatform()
  const sceneRef = useRef<DuelScene | null>(null)
  const [tier, setTier] = useState<EffectTier>('mid')
  const [counters, setCounters] = useState(ZERO_COUNTERS)
  /** 渲染帧率；null 表示这一段里场景一帧都没画（也就是纪律 3.6 里的「停了」）。 */
  const [fps, setFps] = useState<number | null>(null)

  /*
   * 「重开一局」= 换一个 driver。种子固定，所以重开出来的还是同一副牌、同一套演出。
   *
   * 这一页不走 MatchSession（那是给跨路由用的），driver 就活在这个组件的 state 里。
   * 换掉的那一局和卸载时都要 dispose，否则上一局的答题定时器还会接着往里发指令——
   * 换掉那次由下面这个 effect 的清理负责（driver 一变就跑一次）。
   */
  const [driver, setDriver] = useState<LocalDriver>(() => createTestMatch(platform, { seed: SEED }))
  useEffect(() => () => driver.dispose(), [driver])

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
    }, SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="duel-dev">
      <div className="duel-dev__stage">
        <DuelStage
          driver={driver}
          platform={platform}
          seat={0}
          tier={tier}
          sceneRef={sceneRef}
          // 这一页没有可去的地方，顶栏那两颗钮点了不做事。
          onLeave={() => undefined}
        />
        <span className="duel-dev__fps">{fps === null ? '空闲' : `${fps} fps`}</span>
      </div>
      <div className="duel-dev__panel">
        <Button onClick={() => setDriver(createTestMatch(platform, { seed: SEED }))}>
          重开一局
        </Button>
        <span className="duel-dev__group">
          档位
          {TIERS.map((value) => (
            // pressed 既是读屏软件那边的「这一档选着呢」，也是方块按钮反色那一档：
            // 素方块阶段只有这一种手段能在画面上分出当前选的是哪一档。
            <Button key={value} pressed={value === tier} onClick={() => setTier(value)}>
              {value}
            </Button>
          ))}
        </span>
        <span className="duel-dev__counters">
          文字 {counters.textCreated} · 渲染 {counters.renders}
        </span>
      </div>
      {/* 局面怎么摆归测试面板，这一页只管画面和性能。 */}
      <DevPanel driver={driver} />
    </div>
  )
}
