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
import { useEffect, useRef, useState } from 'react'
import { usePlatform } from '../app/platform'
import type { LocalDriver } from '../match/localDriver'
import { createTestMatch } from '../match/localMatch'
import { DuelStage } from '../screens/DuelStage'
import { DevPanel } from './DevPanel'
import { installStageDebug } from './debugHook'
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
   * 这一页不走 MatchSession（那是给跨路由用的），driver 就活在这个组件的 state 里；
   * 换掉的那一份当场 dispose，把它的答题定时器关掉。
   *
   * dispose **不能**写在 effect 的清理里。开发构建下 StrictMode 会把每个 effect 跑两遍
   * （建 → 拆 → 再建），那一次「拆」会把**还在用**的这一局拆掉，之后 `localDriver` 的
   * 每条指令都被 `disposed` 挡回去：画面照常演开局（那批事件是建 driver 时就发好的、
   * 由 driverCore 攒着的），但从此一张牌也打不出去、测试面板每颗钮也都没反应。
   * 正式对局页没踩这一下——那边的 driver 归 MatchSession，只在 `start` / `end` 时拆。
   * 这里照它的办法来：只在换的时候拆，当前这一份存 ref（ref 是同步的，连点两下也不漏拆）。
   */
  const [driver, setDriver] = useState<LocalDriver>(() => createTestMatch(platform, { seed: SEED }))
  const current = useRef(driver)
  const restart = (): void => {
    current.current.dispose()
    const next = createTestMatch(platform, { seed: SEED })
    current.current = next
    setDriver(next)
  }

  /*
   * 把画布的命中反查口子（`window.__aiDuel.stage`）装上，好让自动化脚本按 label 问
   * 「这东西现在在屏幕哪儿」。正式对局页由 MatchScreen 装同一份，这一页从前没装——
   * 于是想在这里复现拖拽问题时只能靠肉眼点，反而要开浏览器手动试。
   * 静态 import 就行：整个 dev 目录只被 App.tsx 那张开发页表动态拉进来，生产构建里不存在。
   * 探针不跟着页面生命周期走（见 installStageDebug），所以不需要清理。
   * 子组件的 effect 先跑，这一句因此晚于 DuelStage 建场景那一步——不要紧：
   * 那一步要先 await 卡面图集，而探针补的是渲染那一层，赶在第一帧之前装上就够了。
   */
  useEffect(() => {
    installStageDebug()
  }, [])

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
        <span className="duel-dev__counters">
          文字 {counters.textCreated} · 渲染 {counters.renders}
        </span>
      </div>
      {/* 局面怎么摆归测试面板，这一页只管画面和性能。 */}
      <DevPanel driver={driver} />
    </div>
  )
}
