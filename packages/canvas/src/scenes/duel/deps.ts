/**
 * 全部组件共用的那一份依赖：两批预烤纹理、文字缓存、补间记账、平台能力、随机数。
 *
 * 每个组件的 `XxxDeps` 都是这份东西的一个子集（结构类型，直接传整份就行），
 * 所以场景只建一份、所有组件共享——文字纹理缓存尤其不能一个组件一份，
 * 那样同一句话会被烤好几遍（纪律 3.5）。
 */

import { createFakePlatform, type Platform, type SoundSpec } from '@ai-duel/platform'
import type { Renderer, Texture } from 'pixi.js'
import type { CardSpriteDeps } from '../../components/CardSprite'
import { type BakedTextures, bakeTextures } from '../../fx/bakedTextures'
import { type EffectTier, TIER_CONFIG } from '../../fx/effectTier'
import { bakeUiTextures, type UiTextures } from '../../fx/uiTextures'
import { Animator } from '../../runtime/animator'
import { Rng } from '../../runtime/rng'
import { TextTextureCache } from '../../runtime/textCache'

export interface DuelDeps {
  ui: UiTextures
  baked: BakedTextures
  text: TextTextureCache
  animator: Animator
  platform: Pick<Platform, 'audio' | 'haptics'>
  /** 按钮按下时叫的那一声。资源不归 canvas 管，暂时一律 null（音频是第 33 条）。 */
  clickSound: SoundSpec | null
  rng: Rng
  tier: EffectTier
  /** 牌背。`FoeHand` 只要这一张，别的组件用不到。 */
  back: Texture
  /** 建卡要的那三样。预热和对局共用同一份，两条路建出来的卡才是一样的。 */
  cardDeps: CardSpriteDeps
}

export interface DuelDepsOptions {
  renderer: Renderer
  tier: EffectTier
  seed: number
  back: Texture
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /**
   * 建出来的卡要不要那层跟指针跑的反光。不给就按效果档位定（`TIER_CONFIG[tier].glare`）。
   *
   * 构筑页显式关掉：那一页的卡不跟指针倾斜，反光层建了也永远不亮，
   * 而它是**整张卡那么大的一层**——一屏二三十张卡，白画一遍就是零点几倍的过度绘制（3.2）。
   */
  glare?: boolean
  /** 补间一建就要叫醒帧循环，否则没人推它（3.6）。 */
  wake: () => void
}

/**
 * 建一份依赖。
 *
 * 没给 platform 时用 platform 包自带的假实现：它本来就是「接口齐全但什么都不做」的那一份，
 * 目录页和 bench 也用它。在这里另写一遍静音实现只会多一处会和真接口跑偏的代码。
 */
export function createDuelDeps(options: DuelDepsOptions): DuelDeps {
  // 先建这两样再组装：`cardDeps` 要指向同一份烤纹理和同一份文字缓存，
  // 写在一个对象字面量里引用不到自己刚建的那两项。
  const baked = bakeTextures(options.renderer)
  const text = new TextTextureCache(options.renderer)
  return {
    ui: bakeUiTextures(options.renderer),
    baked,
    text,
    animator: new Animator(options.wake),
    platform: options.platform ?? createFakePlatform(),
    clickSound: null,
    rng: new Rng(options.seed),
    tier: options.tier,
    back: options.back,
    cardDeps: { baked, text, glare: options.glare ?? TIER_CONFIG[options.tier].glare },
  }
}

/** 上下文丢失之后把「画出来的」纹理重画一遍（4.3）。图片纹理 Pixi 自己会重传。 */
export function restoreDeps(deps: DuelDeps): void {
  deps.ui.restore()
  deps.baked.restore()
  deps.text.restore()
}

/** 拆掉这一份依赖建出来的东西。调用方传进来的卡面纹理不归这里管。 */
export function destroyDeps(deps: DuelDeps): void {
  deps.animator.destroy()
  deps.ui.destroy()
  deps.baked.destroy()
  deps.text.destroy()
}
