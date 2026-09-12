/**
 * 首页（迁移第 30 条）。整页画在画布上，这一层只管两件事：
 * 背景音乐和那句问候、把画布发出来的操作翻译成路由。
 *
 * ## 不再等图
 *
 * 从前这一页是几张整幅图叠出来的一张画，所以要先用 `useAssets` 把 `HOME_IMAGES` 拉完、
 * 中间显示整屏加载页（不等的话玩家会看着夜空、桌子、道具一层层往上冒）。
 * 正式版简化第 4 步把这一页剥成素方块，那几张图删了，这道闸门也跟着去掉。
 *
 * 一进首页就在后台把剩下的图按 `PRELOAD_GROUPS` 排队下完（`useBackgroundPreload`）：
 * 玩家看首页、建房、等对手的那几十秒里，房间页、英雄页、对局那几 MB 就悄悄下好了，
 * 一路点过去看不到任何加载页。
 */

import type { HomeAction } from '@ai-duel/canvas'
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import type { MatchMode } from '../app/MatchSession'
import { useMatchSession } from '../app/MatchSession'
import { usePlatform } from '../app/platform'
import { onTrackReplay, playTrack } from '../audio/music'
import { HOME_INTRO_DELAY_MS, playHomeIntro } from '../audio/sounds'
import type { LocalDriver } from '../match/localDriver'
import { createTestMatch } from '../match/localMatch'
import { useBackgroundPreload } from '../preload/useAssets'
import { HomeStage } from './HomeStage'
import './homeScreen.css'

export function HomeScreen() {
  const platform = usePlatform()
  const { start } = useMatchSession()
  const [, navigate] = useLocation()
  useBackgroundPreload(platform)

  /*
   * 首页的曲子。`playTrack` 自己挡了「已经在放同一首就什么都不做」，
   * 所以从对局回到首页时不会把它从头重开（见 audio/music.ts）。
   */
  useEffect(() => {
    playTrack(platform, 'beginning')
  }, [platform])

  /*
   * 那句问候。开播 3.62 秒之后响一次（落在前奏的空档上），之后每次曲子循环回开头再响一次。
   */
  useEffect(() => {
    const timer = window.setTimeout(() => playHomeIntro(platform), HOME_INTRO_DELAY_MS)
    const stop = onTrackReplay('beginning', () => {
      window.setTimeout(() => playHomeIntro(platform), HOME_INTRO_DELAY_MS)
    })
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [platform])

  /** 交接 driver 再跳转（理由见 app/MatchSession.tsx：driver 得先交给挂在 Router 外面的 Provider）。 */
  const enter = (driver: LocalDriver, mode: MatchMode): void => {
    start(driver, mode)
    navigate('/match')
  }

  const act = (action: HomeAction): void => {
    switch (action.kind) {
      case 'start':
        // 主入口和菜单里那条「联机」去的是同一页：首页不分流。
        navigate('/room')
        break
      case 'menu':
        actMenu(action.item)
        break
    }
  }

  const actMenu = (item: Exclude<HomeAction, { kind: 'start' }>['item']) => {
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

  return (
    <main className="home">
      <HomeStage platform={platform} onAction={act} />
    </main>
  )
}
