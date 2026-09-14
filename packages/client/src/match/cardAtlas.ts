/**
 * 加载对局要用的纹理（卡面图集 + 英雄原画），喂给画布场景。
 *
 * 放在装配层而不是 `canvas` 包里：资源从哪来、走什么协议、要不要缓存，都是平台的事
 *（《正式版架构》第 2 节第 5 条）。场景只收一份「已经准备好的纹理」。
 *
 * 图集由 `pnpm assets:build` 生成，落在各个壳的 `public/atlas/` 下（都在 .gitignore 里）。
 * 没跑过那条命令的话这里会 404，页面上会显示加载失败——那是预期的提示，不是 bug。
 *
 * 装哪几组由调用方按「这个场景用得上什么」挑（纪律 3.4：不让纹理常驻超过当前场景所需）。
 * 三组图集是分开打的，各自的 json 里带着 related_multi_packs，Pixi 会把同组的几页一起加载。
 */

import type { CardTextures } from '@ai-duel/canvas'
import { HEROES } from '@ai-duel/content'
import type { HeroId } from '@ai-duel/core'
import { Assets, type Spritesheet, type Texture } from 'pixi.js'

const MODELS_ATLAS = '/atlas/models-0.webp.json'
const SKILLS_ATLAS = '/atlas/skills-0.webp.json'
const BACKS_ATLAS = '/atlas/backs.webp.json'

/** AI 牌的卡背用哪一张。两张牌背都在同一组图集里，这一版取带花饰的那张。 */
const BACK_FRAME = 'card-back-v4-relaxed-ornament'
/**
 * 技能牌翻过去看到的那张星象底图。
 *
 * 和 `BACK_FRAME` 同一页图集，所以多取一帧不多一次请求、也不多一张纹理。
 */
const SKILL_BACK_FRAME = 'card-back-v1'

/** 英雄原画的地址。和 preload/manifests.ts 的 `HERO_IMAGES` 是同一条「id 即文件名」的约定。 */
function heroArtOf(heroId: HeroId): string {
  return `/hero/card-${heroId}.webp`
}

export interface CardTexturesOptions {
  /**
   * 连技能牌那组图集一起装。
   *
   * 真对局要（一副牌里既有 AI 牌也有技能牌，而且**对手那副是什么并不知道**，
   * 「这一局用得上哪几张」在开局时无从裁剪）；只摆几张牌的地方不要。
   * 少装这一组的后果是技能牌一律显示成牌背（canvas 的 cardVisuals 缺贴图不抛错，退回牌背）。
   */
  skills?: boolean
  /**
   * 连英雄原画一起装。
   *
   * 英雄牌**不进图集**（一局只出现一张，尺寸又比卡面大，打进去只会白占图集页），
   * 所以它们是七次独立的请求。只有真要画侧栏英雄位的地方才值得等这七张。
   */
  heroes?: boolean
}

export async function loadCardTextures(options: CardTexturesOptions = {}): Promise<CardTextures> {
  const atlases = [MODELS_ATLAS, ...(options.skills === true ? [SKILLS_ATLAS] : [])]
  const [backs, ...sheets] = await Promise.all([
    Assets.load<Spritesheet>(BACKS_ATLAS),
    ...atlases.map((url) => Assets.load<Spritesheet>(url)),
  ])

  // 多页图集的帧散在各页的 textures 里，Pixi 会把关联页一起加载并挂在同一份 linkedSheets 上。
  const faces: Record<string, Texture> = {}
  for (const sheet of sheets) {
    Object.assign(faces, sheet.textures)
    for (const linked of sheet.linkedSheets) Object.assign(faces, linked.textures)
  }

  const back = backs.textures[BACK_FRAME]
  if (back === undefined) {
    throw new Error(`图集 ${BACKS_ATLAS} 里没有 ${BACK_FRAME} 这一帧，先跑 pnpm assets:build`)
  }
  // 星象底图少一张不算错：场景收到 undefined 就让技能牌退回用 AI 牌那张卡背。
  const skillBack = backs.textures[SKILL_BACK_FRAME]
  const commonBacks = { back, ...(skillBack === undefined ? {} : { skillBack }) }
  if (options.heroes !== true) return { faces, ...commonBacks }

  /*
   * 英雄原画少一张不算错：用 `allSettled` 而不是 `all`。
   * 一位英雄的图没下下来，代价是侧栏那个位置空着（场景收到 undefined 就不摆），
   * 而整条 Promise 挂掉的代价是整局开不了。
   */
  const ids = Object.keys(HEROES) as HeroId[]
  const loaded = await Promise.allSettled(ids.map((id) => Assets.load<Texture>(heroArtOf(id))))
  const heroes: Record<string, Texture> = {}
  ids.forEach((id, index) => {
    const result = loaded[index]
    if (result?.status === 'fulfilled') heroes[id] = result.value
  })
  return { faces, ...commonBacks, heroes }
}
