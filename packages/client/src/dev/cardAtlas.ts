/**
 * 加载卡面图集，喂给画布场景。
 *
 * 放在装配层而不是 `canvas` 包里：资源从哪来、走什么协议、要不要缓存，都是平台的事
 * （《正式版架构》第 2 节第 5 条，以后走 platform 包）。场景只收一份"已经准备好的纹理"。
 *
 * 图集由 `pnpm assets:build` 生成，落在各个壳的 `public/atlas/` 下（都在 .gitignore 里）。
 * 没跑过那条命令的话这里会 404，页面上会显示加载失败——那是预期的提示，不是 bug。
 */

import type { CardTextures } from '@ai-duel/canvas'
import { Assets, type Spritesheet, type Texture } from 'pixi.js'

/**
 * 对局只装 models 和 backs 两组，技能牌那组不装（3.4：不让纹理常驻超过当前场景所需）。
 * 三组是分开打的图集，各自的 json 里带着 related_multi_packs，Pixi 会把同组的几页一起加载。
 */
const MODELS_ATLAS = '/atlas/models-0.webp.json'
const BACKS_ATLAS = '/atlas/backs.webp.json'

/** 牌背用哪一张。两张牌背都在图集里，这一版取带花饰的那张。 */
const BACK_FRAME = 'card-back-v4-relaxed-ornament'

export async function loadCardAtlas(): Promise<CardTextures> {
  const [models, backs] = await Promise.all([
    Assets.load<Spritesheet>(MODELS_ATLAS),
    Assets.load<Spritesheet>(BACKS_ATLAS),
  ])

  // 多页图集的帧散在各页的 textures 里，Pixi 会把关联页一起加载并挂在同一份 linkedSheets 上。
  const faces: Record<string, Texture> = { ...models.textures }
  for (const sheet of models.linkedSheets) Object.assign(faces, sheet.textures)

  const back = backs.textures[BACK_FRAME]
  if (back === undefined) {
    throw new Error(`图集 ${BACKS_ATLAS} 里没有 ${BACK_FRAME} 这一帧，先跑 pnpm assets:build`)
  }
  return { faces, back }
}
