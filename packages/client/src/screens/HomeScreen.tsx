/**
 * 临时首页：两个进对局的入口，外加开发构建里通往开发页索引的一行。
 *
 * 真首页（那张 1672×941 的画、七个人物、四张展示卡）是第 30 条的事。
 * 这一版存在的意义只有一个——第 21 条要能「从头点进一局单机、打完、回来」，
 * 而那条路上必须有个起点。所以它只用 `ui` 的按钮 A，不摆任何美术资源。
 *
 * 两个入口都在这里建 driver 再跳 `/match`，理由见 app/MatchSession.tsx：
 * driver 得先交给挂在 Router 外面的那个 Provider，跳转才带得走。
 */

import { Button } from '@ai-duel/ui'
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { useMatchSession } from '../app/MatchSession'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { createHotSeatMatch, createTestMatch } from '../match/localMatch'
import './homeScreen.css'

export function HomeScreen() {
  const platform = usePlatform()
  const { start } = useMatchSession()
  const [, navigate] = useLocation()

  /*
   * 首页的曲子。`playTrack` 自己挡了「已经在放同一首就什么都不做」，
   * 所以从对局回到首页时不会把它从头重开（见 audio/music.ts）。
   */
  useEffect(() => {
    playTrack(platform, 'beginning')
  }, [platform])

  const enter = (driver: ReturnType<typeof createTestMatch>, mode: 'test' | 'hotseat') => {
    start(driver, mode)
    navigate('/match')
  }

  return (
    <main className="home">
      <h1 className="home__title">出牌吧！AI</h1>
      <p className="home__note">
        正式版施工中。真首页是迁移第 30 条的事，这一版只留两个进对局的入口。
      </p>
      <div className="home__actions">
        <Button onClick={() => enter(createTestMatch(platform), 'test')}>测试对局</Button>
        <Button onClick={() => enter(createHotSeatMatch(platform), 'hotseat')}>热座</Button>
      </div>
      {/*
        开发页索引只在本地构建里出现。这一整段在生产构建里会连同 import.meta.env.DEV
        一起被当成死代码删掉（同 App.tsx 里那张开发页表）。
      */}
      {import.meta.env.DEV ? (
        <a className="home__dev" href="/dev">
          开发页
        </a>
      ) : null}
    </main>
  )
}
