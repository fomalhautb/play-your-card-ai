/**
 * 把首页场景挂到一块画布上。和 `RoomStage` / `DuelStage` 是同一类东西：
 * 这一层只管**生命周期**（Pixi 的渲染器要在 effect 里建、在清理里拆），
 * 首页那边（`HomeScreen`）因此只管流程，一行 Pixi 都看不见。
 *
 * `<canvas>` 由 effect 自己建、清理时连元素一起摘掉，理由和 `RoomStage` 一模一样：
 * `renderer.destroy()` 会把这块画布的 WebGL 上下文**永久**丢掉，
 * 而 StrictMode 会把每个 effect 跑两遍，第二遍必然落在一块已经废掉的画布上。
 *
 * 图集和那幅画的十一层图都要先装好才建得出场景，所以这一层自己等——
 * 「等图」这件事在 `HomeScreen` 那边已经用进度条挡了一次（`preloadAll`），
 * 到这里时浏览器缓存里都有了，`Assets.load` 只是把它们上传成纹理。
 */

import {
  createHomeScene,
  type HomeAction,
  type HomeCastMember,
  type HomeScene,
  type HomeTextures,
} from '@ai-duel/canvas'
import { HEROES } from '@ai-duel/content'
import type { Platform } from '@ai-duel/platform'
import { useEffect, useRef, useState } from 'react'
import { loadHomeTextures } from '../match/homeArt'
import './homeStage.css'

/** 渲染倍率封顶（纪律 3.3），和对局那边同一个数。 */
const MAX_RESOLUTION = 1.5

export interface HomeStageProps {
  platform: Platform
  /** 一开始静不静音。之后由这一层跟着外面的状态换剪影。 */
  muted: boolean
  onAction(action: HomeAction): void
}

export function HomeStage({ platform, muted, onAction }: HomeStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HomeScene | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * 回调存 ref：场景是建的时候把它焊进去的，而组件每渲染一次都是新函数。
   * 不存 ref 的话要么场景每渲染一次就重建，要么按钮永远调第一次那一版闭包
   *（同 RoomStage / DuelStage 的两颗顶栏钮）。
   */
  const actionRef = useRef(onAction)
  actionRef.current = onAction
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // 每一轮一块全新的画布，理由见文件头。
    const canvas = document.createElement('canvas')
    host.appendChild(canvas)

    let disposed = false

    const boot = async () => {
      const art = await loadHomeTextures()
      if (disposed) return
      const rect = host.getBoundingClientRect()
      const metrics = platform.safeArea.metrics()
      const scene = await createHomeScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(metrics.pixelRatio, MAX_RESOLUTION),
        textures: art.textures satisfies HomeTextures,
        cast: castOf(art),
        cards: art.cards,
        // 开发构建才摆「测试对局」。生产构建里 import.meta.env.DEV 是字面量 false。
        dev: import.meta.env.DEV,
        muted: mutedRef.current,
        platform,
        coarsePointer: platform.safeArea.isCoarsePointer(),
      })
      if (disposed) {
        scene.destroy()
        return
      }
      scene.onAction((action) => actionRef.current(action))
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

  // 静音状态每变一次就换一枚剪影。场景还没建出来时下一次挂载会读 ref 拿到最新那份。
  useEffect(() => {
    sceneRef.current?.setMuted(muted)
  }, [muted])

  return (
    <div className="home-stage" ref={hostRef}>
      {error === null ? null : <p className="home-stage__error">首页起不来：{error}</p>}
    </div>
  )
}

/**
 * 把「抠图 + 英雄数据」拼成场景要的那七个人。
 *
 * 文案直接取 `content` 的 `HEROES`：首页 hover 出来的介绍和选英雄页详情里那一栏
 * 说的是同一件事，两处各维护一份迟早会说不一样（旧版就是各写各的）。
 */
function castOf(art: Awaited<ReturnType<typeof loadHomeTextures>>): HomeCastMember[] {
  return art.cast.map(({ hero, texture }) => {
    const card = HEROES[hero]
    return {
      id: hero,
      name: card.name,
      intro: card.text,
      skillName: card.skillName,
      skillText: card.skillText,
      ...(card.roleText === undefined ? {} : { roleText: card.roleText }),
      art: texture,
    }
  })
}
