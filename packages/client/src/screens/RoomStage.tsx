/**
 * 把房间页场景挂到一块画布上。和 DuelStage 是同一类东西，只是这一页简单得多：
 * 没有 driver、没有演出编排层、没有事件流，只有「摆一份状态、收几颗钮」。
 *
 * 这一层存在的唯一理由是**生命周期**：Pixi 的渲染器要在 effect 里建、在清理里拆，
 * 而 React 组件每渲染一次就是一份新的回调和一份新的状态。两者对不上的地方全在这里，
 * 房间页那边（RoomScreen）因此只管流程，一行 Pixi 都看不见。
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
 */

import { createRoomScene, type RoomAction, type RoomScene, type RoomView } from '@ai-duel/canvas'
import type { Platform } from '@ai-duel/platform'
import { useEffect, useRef, useState } from 'react'
import './roomStage.css'

/** 渲染倍率封顶（纪律 3.3），和对局那边同一个数。 */
const MAX_RESOLUTION = 1.5

export interface RoomStageProps {
  view: RoomView
  platform: Platform
  onAction(action: RoomAction): void
}

export function RoomStage({ view, platform, onAction }: RoomStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<RoomScene | null>(null)
  /**
   * **已经摆给画布**的那一份状态，给开发构建下那个调试口子读（见下面那个 effect）。
   *
   * 不是 React 手上那一份：两者差着一个 effect。端到端用例读到「码没了、回到三颗钮」
   * 之后立刻就会去点某一颗，而这中间画布要是还没换过来，那一下就点在空地上——
   * 报出来的必须是**屏幕上真有的东西**，否则这个口子就是在骗用例。
   */
  const applied = useRef<RoomView | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * 回调和状态各存一份 ref：场景是建的时候把它们焊进去的，而组件每渲染一次都是新的。
   * 不存 ref 的话要么场景每渲染一次就重建，要么按钮永远调的是第一次那一版闭包
   *（同 DuelStage 的两颗顶栏钮）。
   */
  const actionRef = useRef(onAction)
  actionRef.current = onAction
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // 每一轮一块全新的画布，理由见文件头。
    const canvas = document.createElement('canvas')
    host.appendChild(canvas)

    let disposed = false

    const boot = async () => {
      const rect = host.getBoundingClientRect()
      const metrics = platform.safeArea.metrics()
      const scene = await createRoomScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(metrics.pixelRatio, MAX_RESOLUTION),
        platform,
      })
      if (disposed) {
        scene.destroy()
        return
      }
      scene.onAction((action) => actionRef.current(action))
      // 建场景要等一个 await，这中间状态可能已经变过好几轮了，所以摆的是**最新**那一份。
      scene.setView(viewRef.current)
      applied.current = viewRef.current
      sceneRef.current = scene
    }

    boot().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })

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
      canvas.remove()
    }
  }, [platform])

  // 状态每变一次就摆一次。场景自己挡了「同一份不重建」（见 canvas 的 roomPanel）。
  useEffect(() => {
    sceneRef.current?.setView(view)
    applied.current = view
  }, [view])

  /*
   * 开发构建下把画布上这一份状态挂到 `window.__aiDuel.room` 上，给端到端用例读房间码——
   * 那几个字画在画布上，DOM 里根本没有。动态 import 的理由同 MatchScreen 那一处：
   * `import.meta.env.DEV` 在生产构建里是字面量 false，整段连同那个模块一起被删掉。
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let remove: (() => void) | null = null
    let disposed = false
    void import('../dev/debugHook').then(({ installRoomDebug }) => {
      if (disposed) return
      remove = installRoomDebug(() => applied.current ?? viewRef.current)
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [])

  return (
    <div className="room-stage" ref={hostRef}>
      {error === null ? null : <p className="room-stage__error">房间页起不来：{error}</p>}
    </div>
  )
}
