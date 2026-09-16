/**
 * 把 driver、演出编排层和画布场景接成一条链，这是整个对局界面唯一有接线的地方。
 *
 * ```
 *   driver ──事件批──▶ director ──cue──▶ scene ──指令──▶ driver
 *          └─视图──────┴──────────────────┘
 * ```
 *
 * 三条硬性的顺序，错一条画面就不对：
 * 1. **先 `applyView` 再 `director.push`**：编排层排 cue 时要读这一批之后的局面。
 * 2. **一条帧循环推两个时钟**：编排层排在第 3540 毫秒的那条 cue，场景必须在同一刻播。
 *    两条 rAF 各推各的必然错开（见 canvas 的 scenes/duel/clock.ts）。
 * 3. **先 UserAction 后 Command**：场景已经按这个顺序发了，这里原样转发即可。
 *
 * 组件靠 `key` 换座位：热座每换一次手，`MatchView.seat` 就变一次，而场景和编排层都是
 * 建的时候把座位焊死的。整个重挂而不是加一个「换座位」的方法——那要让场景和编排层
 * 各自多一条只有热座会走的分支，而重挂之后场景自己的兜底对账会把画面摆到正确的样子
 *（契约里「中途接手一局」走的就是那条路）。
 *
 * ## `<canvas>` 由这个 effect 自己建，不写在 JSX 里
 *
 * Pixi 的 `renderer.destroy()` 会把这块画布的 WebGL 上下文**永久**丢掉，
 * 同一个 `<canvas>` 元素上再取上下文拿到的还是那个已丢的，新场景什么都画不出来。
 * 而开发构建下 StrictMode 会把每个 effect 跑两遍（建 → 拆 → 再建），
 * 于是第二遍必然落在一块已经废掉的画布上——表现是画面空着、点哪儿都没反应，
 * 而且**时有时无**：第一遍要是还没来得及建出渲染器就被拆掉，反倒没事。
 *
 * 写在 JSX 里没法躲开这一条（React 的 `key` 只换 DOM 元素，不影响 StrictMode 重跑 effect），
 * 所以画布改成在 effect 里现建、清理时连元素一起摘掉：每一轮都是一块全新的画布。
 * 房间页（`RoomStage`）早一步就是这么做的，这里跟上。
 */

import {
  createDirector,
  createDuelScene,
  type Director,
  type DirectorLocks,
  type DuelScene,
  type EffectTier,
  Rng,
} from '@ai-duel/canvas'
import { CARD_FACES, createCatalog } from '@ai-duel/content'
import type { PlayerId, PlayerView } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { toggleMuted } from '../audio/mute'
import { playSkillTargeting } from '../audio/sounds'
import { loadCardTextures } from '../match/cardAtlas'
import type { MatchDriver } from '../match/driver'
import { useMatch, useMatchEvents } from '../match/useMatch'
import './duelStage.css'

/**
 * 效果档位的默认值。先钉死在最高档——按 GPU 跑分自动定档是第 3.7 条的事，
 * 接上之后这个常量换成那边算出来的值。开发页可以用 `tier` 这个 prop 覆盖它。
 */
const DEFAULT_TIER: EffectTier = 'high'

/** 渲染倍率封顶（纪律 3.3）：设备像素比最高按 1.5 渲染，4K 屏不按 2 倍。 */
const MAX_RESOLUTION = 1.5

/** 一帧最多推多久：标签页切回来时两次 rAF 能差好几秒，照实喂进去演出会一口气跳完。 */
const MAX_FRAME_MS = 100

/** 两组锁一不一样。逐字段比是为了避免每帧都去重算一遍「英雄技能现在有没有目标」。 */
function sameLocks(a: DirectorLocks | null, b: DirectorLocks): boolean {
  if (a === null) return false
  const keys = Object.keys(b) as (keyof DirectorLocks)[]
  return keys.every((key) => a[key] === b[key])
}

export interface DuelStageProps {
  driver: MatchDriver
  platform: Platform
  /** 这一端坐哪个座位。换了要靠外面换 `key` 整个重挂（见文件头）。 */
  seat: PlayerId
  /**
   * 顶栏正中那一行连接状态字（「正在重连…」「对方掉线…」）。null 就显示比分。
   * 由调用方算（见 screens/matchStatus.ts）：这一层不认识联机不联机。
   */
  status?: string | null
  /** 顶栏那颗离开钮按下时叫谁。 */
  onLeave(): void
  /** 效果档位，不给就是默认那一档。只有开发页会传（它要现场切档看差别）。 */
  tier?: EffectTier
  /**
   * 玩家在设置页要求「减少动效」：场景据此关掉落地震屏和卡面跟指针跑的倾斜 / 反光。
   *
   * 由调用方现读存档（`loadSave(platform).reducedMotion`）：这一层不认识存档，
   * 而这一位一局之内不会变——设置页在另一条路由上，进那一页就等于离开了这一局。
   */
  reducedMotion?: boolean
  /**
   * 把场景句柄透给外面。只给开发页用——它要读渲染计数和帧率（`scene.counters()`）。
   * 正式界面不该拿到这个句柄：拿到了就会有人绕过这里直接去调场景。
   */
  sceneRef?: RefObject<DuelScene | null>
}

export function DuelStage({
  driver,
  platform,
  seat,
  status = null,
  onLeave,
  tier = DEFAULT_TIER,
  reducedMotion = false,
  sceneRef: outerSceneRef,
}: DuelStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<DuelScene | null>(null)
  const directorRef = useRef<Director | null>(null)
  /** 已经摆给场景的那一份视图。同一份不重复摆（两条路都会送过来，见下面）。 */
  const appliedRef = useRef<PlayerView | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 场景和编排层都就位了没有。
   *
   * 它决定什么时候去订事件流：图集要现下，场景因此比 driver 晚好几百毫秒才建得出来，
   * 而 driver 从建出来那一刻就在产事件。没就位就先不订，让 driverCore 替我们攒着
   *（见 match/useMatch.ts 的 `useMatchEvents`）。
   */
  const [ready, setReady] = useState(false)

  const view = useMatch(driver)

  /*
   * 顶栏那颗钮的回调存 ref：它每次渲染都是新函数，而场景是建的时候把它焊进去的。
   * 不存 ref 的话要么场景每渲染一次就重建，要么按钮永远调的是第一次那一版闭包。
   */
  const handlers = useRef({ onLeave })
  handlers.current = { onLeave }

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // 每一轮一块全新的画布，理由见文件头。
    const canvas = document.createElement('canvas')
    host.appendChild(canvas)

    let disposed = false
    let raf = 0
    let last = 0
    let locks: DirectorLocks | null = null

    const boot = async () => {
      // 英雄原画一起装：侧栏的英雄位和那颗「发动」钮要用（见 match/cardAtlas.ts）。
      const textures = await loadCardTextures({ skills: true, heroes: true })
      if (disposed) return
      const rect = host.getBoundingClientRect()
      const metrics = platform.safeArea.metrics()
      const scene = await createDuelScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(metrics.pixelRatio, MAX_RESOLUTION),
        tier,
        seat,
        textures,
        cardFaces: CARD_FACES,
        catalog: createCatalog(),
        platform,
        coarsePointer: platform.safeArea.isCoarsePointer(),
        // 时钟归这条帧循环推，见文件头第 2 条。
        manualClock: true,
        reducedMotion,
        onLeave: () => handlers.current.onLeave(),
        /*
         * 顶栏那一格静音。传了它顶栏才建这一格（见 canvas 的 components/TopBar.ts）——
         * 对局页是全站唯一不渲染右上角那颗 DOM 静音钮的一页（那个位置压着「离开」，
         * 见 App.tsx），所以这一格是这一页开关声音的唯一入口。
         * `platform` 是这个 effect 的依赖，换了整套重建，闭包不会过期，不必像 onLeave 那样走 ref。
         */
        onToggleMute: () => toggleMuted(platform),
      })
      if (disposed) {
        scene.destroy()
        return
      }
      /*
       * 编排层的随机数（结算层逐卡作答的间隔）用座位号当种子。
       * 定种子是为了同一局重开两次演出一样；不用时间戳是为了让联机时两端的节奏对得上。
       */
      const director = createDirector({ seat, rng: new Rng(seat + 1) })
      scene.onCommand((command) => driver.send(command))
      scene.onUserAction((action) => {
        director.userAction(action)
        // 选目标那一下的音效。场景不碰音频以外的平台能力，这一声由装配层放。
        if (action.kind === 'targeting-begin') playSkillTargeting(platform)
      })
      sceneRef.current = scene
      directorRef.current = director
      if (outerSceneRef !== undefined) outerSceneRef.current = scene
      // 就位了才去订事件流，理由见 ready 的注释。
      setReady(true)

      const frame = (stamp: number) => {
        raf = window.requestAnimationFrame(frame)
        const deltaMs = last === 0 ? 0 : Math.min(MAX_FRAME_MS, stamp - last)
        last = stamp
        if (deltaMs <= 0) return
        director.advance(deltaMs)
        const cues = director.drain()
        if (cues.length > 0) scene.play(cues)
        const next = director.locks()
        // 没变就不喂：场景收到锁要重算手牌和几颗按钮的状态，每帧都算是白算。
        if (!sameLocks(locks, next)) {
          locks = next
          scene.setLocks(next)
        }
        scene.step(deltaMs)
      }
      raf = window.requestAnimationFrame(frame)
    }

    boot().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })

    // 视口跟着容器走，桌面和手机两档各按各的版式排（需求第 3 条）。
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      sceneRef.current?.resize(width, height)
    })
    observer.observe(host)

    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      observer.disconnect()
      sceneRef.current?.destroy()
      sceneRef.current = null
      directorRef.current = null
      appliedRef.current = null
      if (outerSceneRef !== undefined) outerSceneRef.current = null
      canvas.remove()
      setReady(false)
    }
    // 依赖里这几样都是建场景和编排层时焊死的，换了任何一样都要整套重建。
  }, [driver, platform, seat, tier, reducedMotion, outerSceneRef])

  /**
   * 摆一份视图。两条路都会送过来（事件批和快照），同一份只摆一次。
   *
   * 场景还没建出来时**什么都不记**：记了的话这一份就再也补不上了，
   * 而下面那条兜底的路正指望着它还没被记过。
   */
  const applyView = (next: PlayerView): void => {
    const scene = sceneRef.current
    if (scene === null || appliedRef.current === next) return
    appliedRef.current = next
    scene.applyView(next)
  }

  // 事件批：先摆局面再喂编排层（文件头第 1 条）。
  useMatchEvents(ready ? driver : null, (batch) => {
    applyView(batch.view)
    directorRef.current?.push(batch)
  })

  /*
   * 没有事件、只有新局面的那条路——两种情况：
   * 联机重连后的 `match:snapshot`（协议第 5 条：整份替换，不补发事件），
   * 以及**热座换手后重挂的这一份新场景**（它要等下一条指令才会收到事件，
   * 在那之前得先把当前局面摆出来，靠场景自己的兜底对账把画面补齐）。
   * 正常打的时候走不到：事件批那条路已经把同一份视图摆过了，
   * `applyView` 里那道「同一份不重摆」会在这儿挡下来。
   */
  useEffect(() => {
    if (view.view !== null) applyView(view.view)
  })

  /*
   * 顶栏那行连接状态字。依赖里带上 `ready`：场景是异步建出来的，
   * 在那之前这个 effect 跑过也没人收，得等场景就位再补一次。
   */
  useEffect(() => {
    if (!ready) return
    sceneRef.current?.setStatus(status)
  }, [status, ready])

  /*
   * 顶栏那一格静音跟着真身走：先灌一次当前值，再订阅后面的变化。
   *
   * 订阅的是 `platform.audio` 而不是 `useMuted`：状态变了只该换顶栏里那一张文字纹理，
   * 没必要让整个对局界面重渲染一遍。同样带上 `ready`——场景是异步建出来的。
   */
  useEffect(() => {
    if (!ready) return
    const scene = sceneRef.current
    if (scene === null) return
    scene.setMuted(platform.audio.isMuted())
    return platform.audio.onMutedChange((muted) => scene.setMuted(muted))
  }, [ready, platform])

  // 对局中断：编排层要一次性清场，否则玩家会被一层退不掉的遮罩挡死。
  useEffect(() => {
    if (view.status === 'aborted') directorRef.current?.abort()
  }, [view.status])

  return (
    <div className="duel-stage" ref={hostRef}>
      {error === null ? null : <p className="duel-stage__error">对局起不来：{error}</p>}
    </div>
  )
}
