/**
 * 把开包场景挂到一块画布上。和 `HomeStage` / `HeroStage` 是同一类东西：只管生命周期。
 * `<canvas>` 在 effect 里现建、清理时连元素一起摘掉，理由见 `RoomStage` 的文件头。
 */

import { createPackScene, type PackAction, type PackScene, type PackView } from '@ai-duel/canvas'
import type { Platform } from '@ai-duel/platform'
import { useEffect, useRef, useState } from 'react'
import './packStage.css'

/** 渲染倍率封顶（纪律 3.3），和对局那边同一个数。 */
const MAX_RESOLUTION = 1.5

export interface PackStageProps {
  view: PackView
  platform: Platform
  onAction(action: PackAction): void
}

export function PackStage({ view, platform, onAction }: PackStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PackScene | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actionRef = useRef(onAction)
  actionRef.current = onAction
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const canvas = document.createElement('canvas')
    host.appendChild(canvas)

    let disposed = false

    const boot = async () => {
      const rect = host.getBoundingClientRect()
      const metrics = platform.safeArea.metrics()
      const scene = await createPackScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(metrics.pixelRatio, MAX_RESOLUTION),
        platform,
        coarsePointer: platform.safeArea.isCoarsePointer(),
      })
      if (disposed) {
        scene.destroy()
        return
      }
      scene.onAction((action) => actionRef.current(action))
      // 建场景要等一个 await，这中间状态可能已经变过，所以摆的是**最新**那一份。
      scene.setView(viewRef.current)
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

  useEffect(() => {
    sceneRef.current?.setView(view)
  }, [view])

  return (
    <div className="pack-stage" ref={hostRef}>
      {error === null ? null : <p className="pack-stage__error">开包页起不来：{error}</p>}
    </div>
  )
}
