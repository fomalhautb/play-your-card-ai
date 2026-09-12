/**
 * 首页（迁移第 30 条）。整页画在画布上，这一层只管四件事：
 * 等图、背景音乐和那句问候、把画布发出来的操作翻译成路由、静音。
 *
 * ## 为什么要等图
 *
 * 首页是十几张整幅图叠出来的一张画。浏览器是拿到一张画一张，不等的话玩家会看着
 * 夜空、人物、桌子、道具一层层往上冒（旧版 `HomeScreen` 同一条理由）。
 * 所以先用 `useAssets` 把 `HOME_IMAGES` 拉完，这中间显示整屏加载页。
 *
 * 首页一亮出来，就在后台把剩下的图按 `PRELOAD_GROUPS` 排队下完（`useBackgroundPreload`）：
 * 玩家看首页、建房、等对手的那几十秒里，房间页、英雄页、对局那几 MB 就悄悄下好了，
 * 一路点过去看不到任何加载页。闸门没放行之前不能开这一趟——两边会抢同样的并发额度。
 *
 * ## 「开始游戏」的分流在点下去那一刻现读存档
 *
 * 不在挂载时读一次：教程和首页之间来回跳时，提前读的那份会是过期的（旧版踩过）。
 */

import type { HomeAction } from '@ai-duel/canvas'
import { useEffect } from 'react'
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
import { useAssets, useBackgroundPreload } from '../preload/useAssets'
import { loadSave } from '../save/saveStore'
import { HomeStage } from './HomeStage'
import { LoadingScreen } from './LoadingScreen'
import './homeScreen.css'

export function HomeScreen() {
  const platform = usePlatform()
  const { start } = useMatchSession()
  const [, navigate] = useLocation()
  const muted = useMuted(platform)
  const assets = useAssets(platform, HOME_IMAGES)
  useBackgroundPreload(platform, assets.ready)

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
      case 'account':
        navigate('/account')
        break
      case 'about':
        navigate('/info')
        break
      case 'settings':
        navigate('/settings')
        break
    }
  }

  if (!assets.ready) return <LoadingScreen progress={assets.progress} text="正在把这幅画摆好…" />

  return (
    <main className="home">
      <HomeStage platform={platform} muted={muted} onAction={act} />
    </main>
  )
}
