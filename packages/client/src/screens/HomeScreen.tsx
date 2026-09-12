/**
 * 首页（迁移第 30 条）。整页画在画布上，这一层只管四件事：
 * 等图、背景音乐和那句问候、把画布发出来的操作翻译成路由、静音。
 *
 * ## 为什么要等图
 *
 * 首页是十几张整幅图叠出来的一张画。浏览器是拿到一张画一张，不等的话玩家会看着
 * 夜空、人物、桌子、道具一层层往上冒（旧版 `HomeScreen` 同一条理由）。
 * 所以先用 `preloadAll` 把 `HOME_IMAGES` 拉完，这中间显示一条进度条。
 * **正式的加载页是第 31 条的事**，这条进度条是临时的，到那时整个换掉。
 *
 * ## 「开始游戏」的分流在点下去那一刻现读存档
 *
 * 不在挂载时读一次：教程和首页之间来回跳时，提前读的那份会是过期的（旧版踩过）。
 */

import type { HomeAction } from '@ai-duel/canvas'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import type { MatchMode } from '../app/MatchSession'
import { useMatchSession } from '../app/MatchSession'
import { usePlatform } from '../app/platform'
import { onTrackReplay, playTrack } from '../audio/music'
import { toggleMuted, useMuted } from '../audio/mute'
import { HOME_INTRO_DELAY_MS, playHomeIntro } from '../audio/sounds'
import type { LocalDriver } from '../match/localDriver'
import { createTestMatch } from '../match/localMatch'
import { HOME_IMAGES } from '../preload/manifests'
import { type PreloadState, preloadAll, preloadState } from '../preload/preload'
import { loadSave } from '../save/saveStore'
import { HomeStage } from './HomeStage'
import './homeScreen.css'

export function HomeScreen() {
  const platform = usePlatform()
  const { start } = useMatchSession()
  const [, navigate] = useLocation()
  const muted = useMuted(platform)
  /*
   * 首帧先同步问一句「这批图有结果了吗」：从别的页面回到首页时它们早就在缓存里，
   * 先问一次就不用闪一下进度条（见 preload/preload.ts 的 preloadState）。
   */
  const [assets, setAssets] = useState<PreloadState>(() => preloadState(platform, HOME_IMAGES))

  /*
   * 不先判「是不是已经就绪」再决定要不要排队：图早就有结果时 `preloadAll` 会立刻
   * 报一次满格然后 resolve（见 preload/preload.ts），多排这一趟一个请求都不会发。
   * 反过来，加一句 `if (assets.ready) return` 就等于把 `assets` 拖进依赖，
   * 于是每报一次进度都要重排一遍队。
   */
  useEffect(() => {
    let alive = true
    void preloadAll(platform, HOME_IMAGES, (state) => {
      if (alive) setAssets(state)
    })
    return () => {
      alive = false
    }
  }, [platform])

  /*
   * 首页的曲子。`playTrack` 自己挡了「已经在放同一首就什么都不做」，
   * 所以从对局回到首页时不会把它从头重开（见 audio/music.ts）。
   */
  useEffect(() => {
    playTrack(platform, 'beginning')
  }, [platform])

  /*
   * 那句问候。开播 3.62 秒之后响一次（落在前奏的空档上），之后每次曲子循环回开头再响一次。
   * 图还没到齐时不排：那时玩家看到的是进度条，一句「这题你 AI 会吗」响在空页面上很怪。
   */
  useEffect(() => {
    if (!assets.ready) return
    const timer = window.setTimeout(() => playHomeIntro(platform), HOME_INTRO_DELAY_MS)
    const stop = onTrackReplay('beginning', () => {
      window.setTimeout(() => playHomeIntro(platform), HOME_INTRO_DELAY_MS)
    })
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [platform, assets.ready])

  /** 交接 driver 再跳转（理由见 app/MatchSession.tsx：driver 得先交给挂在 Router 外面的 Provider）。 */
  const enter = (driver: LocalDriver, mode: MatchMode): void => {
    start(driver, mode)
    navigate('/match')
  }

  const act = (action: HomeAction): void => {
    switch (action.kind) {
      case 'start':
        // 新号先走一遍新手教程，走完（或中途跳过）之后每次都直接进联机。
        // 教程是第 32 条，那条路由还没有——没走过教程的玩家现在会落到 404，
        // 这是明知的缺口，等第 32 条补上。
        navigate(loadSave(platform).tutorialDone ? '/room' : '/tutorial')
        break
      case 'menu':
        actMenu(action.item)
        break
      case 'toggle-mute':
        toggleMuted(platform)
        break
    }
  }

  const actMenu = (
    item: Exclude<HomeAction, { kind: 'start' } | { kind: 'toggle-mute' }>['item'],
  ) => {
    switch (item) {
      case 'test':
        enter(createTestMatch(platform), 'test')
        break
      case 'online':
        navigate('/room')
        break
      case 'deck':
        navigate('/deck')
        break
      case 'hero':
        navigate('/hero')
        break
      // 关于和设置是第 31 条，那两条路由还不在。路由不在时 wouter 会走兜底那一条，
      // 玩家看到的是「没有这一页」——比把入口藏起来好：这几页确实要有，只是还没做。
      case 'about':
        navigate('/about')
        break
      case 'settings':
        navigate('/settings')
        break
    }
  }

  if (!assets.ready) {
    return (
      <main className="home home--loading">
        <p className="home__loading-text">正在把这幅画摆好…</p>
        {/*
          临时进度条。正式的加载页（需求单条 B）是第 31 条的事，那时这一段整个删掉。
          宽度写成内联样式而不是 CSS 变量：它每帧都在变，进变量表只是绕一圈。
        */}
        <div className="home__loading-bar">
          <i style={{ width: `${Math.round(assets.progress * 100)}%` }} />
        </div>
      </main>
    )
  }

  return (
    <main className="home">
      <HomeStage platform={platform} muted={muted} onAction={act} />
    </main>
  )
}
