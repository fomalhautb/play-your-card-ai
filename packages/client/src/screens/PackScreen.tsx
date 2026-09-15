/**
 * 开包页（`/pack?card=<卡 id>`，迁移第 29 条）。
 *
 * 只在**赢了一局并且真抽到新卡**时才会走到这儿：`recordWin` 抽不到就返回 null，
 * 那时对局的结算页照常只给「再来一局 / 回首页」（见 MatchScreen）。
 *
 * ## 卡 id 走查询串，不走内存
 *
 * 这一页只显示一张牌，那张牌是**上一步已经写进存档的**（`recordWin` 里就加进收藏了），
 * 所以查询串里带的不是什么秘密，刷新页面重看一遍也没有副作用。
 * 换成一个模块级的「待开的包」变量反而更糟：刷新之后那个变量是空的，
 * 玩家会莫名其妙被弹回首页。
 *
 * 图集要现装（`PackStage` 里那个 await），所以这一页第一帧是空的——
 * 它只在一局打完之后出现，那时图集早就在缓存里了，不再另设一道闸门。
 */

import { CARD_KIND_INK, type PackAction, type PackView } from '@ai-duel/canvas'
import { CARDS } from '@ai-duel/content'
import { useEffect, useState } from 'react'
import { useLocation, useSearch } from 'wouter'
import { usePlatform } from '../app/platform'
import { loadCardTextures } from '../match/cardAtlas'
import { PackStage } from './PackStage'
import { packCardOf } from './packRoute'
import './packScreen.css'

/** 两类牌的标识色，和对局那边同一份（canvas 导出的 CARD_KIND_INK）。Pixi 的 tint 吃的是数。 */
const ACCENT = {
  ai: Number.parseInt(CARD_KIND_INK.ai.slice(1), 16),
  skill: Number.parseInt(CARD_KIND_INK.skill.slice(1), 16),
}

export function PackScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const search = useSearch()
  const card = packCardOf(search)
  const [view, setView] = useState<PackView | null>(null)

  /*
   * 卡面纹理装完才摆得出这一页。装不出来（图集没打）就跳回首页——
   * 一页永远空着比弹回去更让人摸不着头脑。
   */
  useEffect(() => {
    if (card === null) {
      navigate('/', { replace: true })
      return
    }
    let disposed = false
    void loadCardTextures().then((textures) => {
      if (disposed) return
      setView({
        phase: 'closed',
        card: {
          // 这一页一次只摆一张牌，实例 id 直接用卡牌 id 就够认（见 CardVisual.instanceId）。
          instanceId: card,
          name: CARDS[card]?.name ?? card,
          cost: CARDS[card]?.tokenCost ?? 0,
          face: textures.faces[card] ?? textures.back,
          back: textures.back,
          accent: CARDS[card]?.kind === 'skill' ? ACCENT.skill : ACCENT.ai,
        },
      })
    })
    return () => {
      disposed = true
    }
  }, [card, navigate])

  const act = (action: PackAction): void => {
    if (action.kind === 'continue') {
      navigate('/')
      return
    }
    // 翻面的演出由场景播，这一层只把状态推到下一步。
    setView((current) => (current === null ? null : { ...current, phase: 'opened' }))
  }

  if (view === null) return null
  return (
    <main className="pack">
      <PackStage view={view} platform={platform} onAction={act} />
    </main>
  )
}
