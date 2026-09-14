/**
 * 装首页和选英雄页要的东西，喂给画布场景。
 *
 * 和 `cardAtlas.ts` 是同一类东西的另一半：资源从哪来、走什么协议、要不要缓存都是平台的事
 *（《正式版架构》第 2 节第 5 条），场景只收一份「已经准备好的纹理」。
 *
 * 首页那边现在只剩四张展示卡：正式版简化第 4 步把这一页剥成素方块，
 * 夜空底、桌面弧、前景道具、匾额底图四张整幅图连同素材一起删了。
 * 选英雄页那几张图还在 `preload/manifests.ts` 里登记着，走到这里时浏览器缓存里已经有了，
 * `Assets.load` 只是把它们解码并上传成纹理。
 */

import { type CardVisual, createCardVisuals } from '@ai-duel/canvas'
import { CARD_FACES, createCatalog, HEROES } from '@ai-duel/content'
import type { HeroId } from '@ai-duel/core'
import { Assets, type Texture } from 'pixi.js'
import { HOME_SHOWCASE } from '../screens/homeCast'
import { loadCardTextures } from './cardAtlas'

/**
 * 首页橱窗里那四张展示卡的展示数据。卡面在卡面图集里。
 *
 * 走对局那边同一份 `createCardVisuals`，不在这儿另推一套：卡面分几档、费用章摆哪儿、
 * 盘底什么色是一整套规则（见 canvas 的 scenes/duel/cardVisuals.ts），
 * 抄第二份的结果一定是首页的卡和对局里同一张牌长得不一样。
 */
export async function loadHomeCards(): Promise<CardVisual[]> {
  const atlas = await loadCardTextures()
  const visuals = createCardVisuals(createCatalog(), atlas, CARD_FACES)
  // 同一张牌在这一页只出现一次，但仍带一个序号，和对局那边的实例 id 一个路数。
  return HOME_SHOWCASE.map((id, index) => visuals.visualOf(id, `${id}#${index}`))
}

/** 选英雄页要的：背景一张、七位英雄各一张原画。 */
export async function loadHeroTextures(): Promise<{
  background: Texture
  heroes: Record<HeroId, Texture>
}> {
  const ids = Object.keys(HEROES) as HeroId[]
  const [background, ...arts] = await Promise.all([
    Assets.load<Texture>('/hero/hero-bg.webp'),
    ...ids.map((id) => Assets.load<Texture>(`/hero/card-${id}.webp`)),
  ])
  const heroes = {} as Record<HeroId, Texture>
  ids.forEach((id, index) => {
    const art = arts[index]
    if (art !== undefined) heroes[id] = art
  })
  return { background, heroes }
}
