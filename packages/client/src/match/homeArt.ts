/**
 * 装首页和选英雄页要的纹理，喂给画布场景。
 *
 * 和 `cardAtlas.ts` 是同一类东西的另一半：资源从哪来、走什么协议、要不要缓存都是平台的事
 *（《正式版架构》第 2 节第 5 条），场景只收一份「已经准备好的纹理」。
 * 分成两个文件是因为要的东西不一样——那边是卡面图集，这边是一张张整幅的界面图。
 *
 * 这几张图在 `preload/manifests.ts` 里都登记过，所以走到这里时浏览器缓存里已经有了，
 * `Assets.load` 只是把它们解码并上传成纹理。
 */

import type { CardVisual } from '@ai-duel/canvas'
import { CARDS, HEROES } from '@ai-duel/content'
import type { CardId, HeroId } from '@ai-duel/core'
import { tokens } from '@ai-duel/design'
import { Assets, type Texture } from 'pixi.js'
import { HOME_OCCLUDERS, HOME_SHOWCASE, homeArtUrl } from '../screens/homeCast'
import { loadCardTextures } from './cardAtlas'

/** 三类牌的标识色，和对局那边同一份（canvas 的 scenes/duel/cardVisuals.ts）。 */
const ACCENT = {
  ai: Number.parseInt(tokens.color.accent.ai.slice(1), 16),
  skill: Number.parseInt(tokens.color.accent.skill.slice(1), 16),
}

export interface HomeArt {
  textures: {
    background: Texture
    table: Texture
    props: Texture
    plaque: Texture
  }
  cards: CardVisual[]
}

/** 首页要的全部纹理：那幅画的四层，加四张展示卡的卡面（后者在卡面图集里）。 */
export async function loadHomeTextures(): Promise<HomeArt> {
  const files = ['home-bg', ...HOME_OCCLUDERS, 'home-plaque']
  const [atlas, ...textures] = await Promise.all([
    loadCardTextures(),
    ...files.map((file) => Assets.load<Texture>(homeArtUrl(file))),
  ])
  const at = (file: string): Texture => textures[files.indexOf(file)] ?? atlas.back

  return {
    textures: {
      background: at('home-bg'),
      // 这两层的顺序就是画上的层叠顺序：桌面弧在下、前景道具在上。
      table: at(HOME_OCCLUDERS[0]),
      props: at(HOME_OCCLUDERS[1]),
      plaque: at('home-plaque'),
    },
    cards: HOME_SHOWCASE.map((id, index) => visualOf(id, index, atlas.faces, atlas.back)),
  }
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

/** 一张展示卡的展示数据。和对局那边的 `cardVisuals.ts` 是同一条「id 即贴图名」的约定。 */
function visualOf(
  id: CardId,
  index: number,
  faces: Record<string, Texture>,
  back: Texture,
): CardVisual {
  const card = CARDS[id]
  return {
    // 同一张牌在这一页只出现一次，但仍带一个序号，和对局那边的实例 id 一个路数。
    instanceId: `${id}#${index}`,
    name: card?.name ?? id,
    cost: card?.tokenCost ?? 0,
    face: faces[id] ?? back,
    back,
    accent: card?.kind === 'skill' ? ACCENT.skill : ACCENT.ai,
  }
}
