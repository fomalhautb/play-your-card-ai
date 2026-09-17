/**
 * 装选英雄页要的图，喂给画布场景。（原先叫 homeArt：首页那几张图和展示卡删光之后
 * 这里只剩英雄原画，名字跟着改了。）
 *
 * 和 `cardAtlas.ts` 是同一类东西的另一半：资源从哪来、走什么协议、要不要缓存都是平台的事
 *（《正式版架构》第 2 节第 5 条），场景只收一份「已经准备好的纹理」。
 *
 * 首页现在**什么都不要**了：正式版简化第 4 步把这一页剥成素方块（夜空底、桌面弧、
 * 前景道具、匾额底图四张整幅图连同素材一起删了），后来那一排展示卡也删了，
 * 所以这里只剩选英雄页那七张人物卡（之五把那一页的背景底图也删了）。
 * 这七张还在 `preload/manifests.ts` 里登记着，走到这里时浏览器缓存里已经有了，
 * `Assets.load` 只是把它们解码并上传成纹理。
 */

import { HEROES } from '@ai-duel/content'
import type { HeroId } from '@ai-duel/core'
import { Assets, type Texture } from 'pixi.js'

/** 选英雄页要的：七位英雄各一张原画（圆角在构建期就烤进 alpha 了，见 assets/build-atlas.mjs）。 */
export async function loadHeroTextures(): Promise<Record<HeroId, Texture>> {
  const ids = Object.keys(HEROES) as HeroId[]
  const arts = await Promise.all(ids.map((id) => Assets.load<Texture>(`/hero/card-${id}.webp`)))
  const heroes = {} as Record<HeroId, Texture>
  ids.forEach((id, index) => {
    const art = arts[index]
    if (art !== undefined) heroes[id] = art
  })
  return heroes
}
