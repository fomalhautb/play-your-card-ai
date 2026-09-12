/**
 * 选英雄页（`/hero`）。整页画在画布上，这一层只管四件事：
 * 等图、背景音乐、这一页那份状态（选中谁 / 详情开在谁身上），以及确认之后写存档。
 *
 * 画布那边是**受控**的（见 canvas 的 heroContract.ts）：它不导航、不写存档，
 * 只把「玩家点了哪一颗」发回来。同一份界面将来还要给匹配房和教程用，
 * 那两条入口的「确认之后去哪」各不相同——判断留在这一层，界面就只有一份。
 */

import type { HeroAction, HeroView } from '@ai-duel/canvas'
import { HEROES } from '@ai-duel/content'
import type { HeroId } from '@ai-duel/core'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { toggleMuted, useMuted } from '../audio/mute'
import { HERO_IMAGES } from '../preload/manifests'
import { type PreloadState, preloadAll, preloadState } from '../preload/preload'
import { loadSave, saveHero } from '../save/saveStore'
import { HeroStage } from './HeroStage'
import './heroScreen.css'

export function HeroScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const muted = useMuted(platform)
  const [assets, setAssets] = useState<PreloadState>(() => preloadState(platform, HERO_IMAGES))
  /** 存档里确认过的那位当初值。之后以玩家在这一页上的选择为准。 */
  const [selectedId, setSelectedId] = useState<HeroId | null>(() => loadSave(platform).savedHero)
  const [detailId, setDetailId] = useState<HeroId | null>(null)

  /*
   * 不先判「是不是已经就绪」再决定要不要排队：图早就有结果时 `preloadAll` 会立刻
   * 报一次满格然后 resolve（见 preload/preload.ts），多排这一趟一个请求都不会发。
   * 反过来，加一句 `if (assets.ready) return` 就等于把 `assets` 拖进依赖，
   * 于是每报一次进度都要重排一遍队。
   */
  useEffect(() => {
    let alive = true
    void preloadAll(platform, HERO_IMAGES, (state) => {
      if (alive) setAssets(state)
    })
    return () => {
      alive = false
    }
  }, [platform])

  // 选卡组 / 选英雄那一档的曲子。回首页或进对局时由那边换掉。
  useEffect(() => {
    playTrack(platform, 'cardsSelecting')
  }, [platform])

  const act = (action: HeroAction): void => {
    switch (action.kind) {
      case 'open':
        setDetailId(asHero(action.hero))
        break
      case 'close':
        setDetailId(null)
        break
      case 'confirm': {
        const hero = asHero(action.hero)
        if (hero === null) return
        setSelectedId(hero)
        saveHero(platform, hero)
        setDetailId(null)
        navigate('/')
        break
      }
      case 'back':
        navigate('/')
        break
      case 'toggle-mute':
        toggleMuted(platform)
        break
    }
  }

  const view: HeroView = {
    selectedId,
    detailId,
    // 从首页进来是真的选英雄，所以摆「确认英雄」。匹配房那条纯查看的入口是第 27b 条
    // 留下的坑，接上时把这一项改成由调用方给。
    confirmable: true,
  }

  if (!assets.ready) {
    return (
      <main className="hero hero--loading">
        <p className="hero__loading-text">正在请他们上场…</p>
        <div className="hero__loading-bar">
          <i style={{ width: `${Math.round(assets.progress * 100)}%` }} />
        </div>
      </main>
    )
  }

  return (
    <main className="hero">
      <HeroStage view={view} platform={platform} muted={muted} onAction={act} />
    </main>
  )
}

/**
 * 把画布发回来的那个字符串收回成英雄 id。
 *
 * 画布不认识 `content`（依赖方向），所以它发的是一个普通字符串；这里查一遍表，
 * 对不上就当没这回事——比断言一下强转安全，而且这条路唯一会走到的情况是有人改了名单。
 */
function asHero(id: string): HeroId | null {
  return id in HEROES ? (id as HeroId) : null
}
