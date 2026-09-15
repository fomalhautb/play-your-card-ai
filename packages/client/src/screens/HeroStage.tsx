/**
 * 把选英雄页场景挂到一块画布上。和 `HomeStage` / `RoomStage` 是同一类东西：
 * 只管生命周期，`HeroScreen` 因此一行 Pixi 都看不见。
 * `<canvas>` 在 effect 里现建、清理时连元素一起摘掉，理由见 `RoomStage` 的文件头。
 */

import {
  createHeroScene,
  type HeroAction,
  type HeroEntry,
  type HeroScene,
  type HeroView,
} from '@ai-duel/canvas'
import { HEROES } from '@ai-duel/content'
import type { HeroId } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { useEffect, useRef, useState } from 'react'
import { loadHeroTextures } from '../match/homeArt'
import './heroStage.css'

/** 渲染倍率封顶（纪律 3.3），和对局那边同一个数。 */
const MAX_RESOLUTION = 1.5

export interface HeroStageProps {
  view: HeroView
  platform: Platform
  onAction(action: HeroAction): void
}

export function HeroStage({ view, platform, onAction }: HeroStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HeroScene | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * 回调和状态各存一份 ref：场景是建的时候把它们焊进去的，而组件每渲染一次都是新的
   *（同 RoomStage）。建场景要等一个 await，这中间状态可能已经变过好几轮。
   */
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
      const arts = await loadHeroTextures()
      if (disposed) return
      const rect = host.getBoundingClientRect()
      const metrics = platform.safeArea.metrics()
      const scene = await createHeroScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(metrics.pixelRatio, MAX_RESOLUTION),
        heroes: entriesOf(arts),
        coarsePointer: platform.safeArea.isCoarsePointer(),
      })
      if (disposed) {
        scene.destroy()
        return
      }
      scene.onAction((action) => actionRef.current(action))
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

  // 状态每变一次就摆一次。场景自己挡了「同一份不重建」（见 canvas 的 HeroScene）。
  useEffect(() => {
    sceneRef.current?.setView(view)
  }, [view])

  return (
    <div className="hero-stage" ref={hostRef}>
      {error === null ? null : <p className="hero-stage__error">选英雄页起不来：{error}</p>}
    </div>
  )
}

/**
 * 把 `content` 的英雄表摊成场景要的那七位，顺序就是表的键序
 *（那边有约定：已实装的在前，`comingSoon` 的排在最后，见 content 的 heroes.ts）。
 */
function entriesOf(arts: Record<HeroId, import('pixi.js').Texture>): HeroEntry[] {
  return (Object.keys(HEROES) as HeroId[]).map((id) => {
    const hero = HEROES[id]
    return {
      id,
      name: hero.name,
      enName: hero.enName,
      text: hero.text,
      skillName: hero.skillName,
      skillText: hero.skillText,
      ...(hero.roleText === undefined ? {} : { roleText: hero.roleText }),
      ...(hero.comingSoon === true ? { comingSoon: true } : {}),
      art: arts[id],
    }
  })
}
