/**
 * 选英雄页（`/hero`）。整页画在画布上，这一层只管四件事：
 * 等图、背景音乐、这一页那份状态（选中谁 / 详情开在谁身上），以及确认之后写存档。
 *
 * 画布那边是**受控**的（见 canvas 的 heroContract.ts）：它不导航、不写存档，
 * 只把「玩家点了哪一颗」发回来。同一份界面将来还要给匹配房用，
 * 那两条入口的「确认之后去哪」各不相同——判断留在这一层，界面就只有一份。
 */

import type { HeroAction, HeroView } from '@ai-duel/canvas'
import { HEROES } from '@ai-duel/content'
import type { HeroId } from '@ai-duel/core'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { HERO_IMAGES } from '../preload/manifests'
import { useAssets } from '../preload/useAssets'
import { loadSave, saveHero } from '../save/saveStore'
import { HeroStage } from './HeroStage'
import { LoadingScreen } from './LoadingScreen'
import './heroScreen.css'

export function HeroScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const assets = useAssets(platform, HERO_IMAGES)
  /** 存档里确认过的那位当初值。之后以玩家在这一页上的选择为准。 */
  const [selectedId, setSelectedId] = useState<HeroId | null>(() => loadSave(platform).savedHero)
  const [detailId, setDetailId] = useState<HeroId | null>(null)

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
    }
  }

  const view: HeroView = {
    selectedId,
    detailId,
    // 从首页进来是真的选英雄，所以摆「确认英雄」。匹配房那条纯查看的入口是第 27b 条
    // 留下的坑，接上时把这一项改成由调用方给。
    confirmable: true,
  }

  if (!assets.ready) return <LoadingScreen progress={assets.progress} />

  return (
    <main className="hero">
      <HeroStage view={view} platform={platform} onAction={act} />
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
