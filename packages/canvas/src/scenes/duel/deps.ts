/**
 * 全部组件共用的那一份依赖：预烤纹理、文字缓存、补间记账、平台能力、随机数。
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
import { Animator } from '../../runtime/animator'
import { Rng } from '../../runtime/rng'
import { TextTextureCache } from '../../runtime/textCache'

export interface DuelDeps {
  baked: BakedTextures
  text: TextTextureCache
  animator: Animator
  platform: Pick<Platform, 'audio' | 'haptics'>
  /** 按钮按下时叫的那一声。资源不归 canvas 管，暂时一律 null（音频是第 33 条）。 */
  clickSound: SoundSpec | null
  rng: Rng
  tier: EffectTier
  /**
   * 玩家要求「减少动效」。组件照它关掉会动的东西：落地震屏（HitFx）、
   * 卡面跟指针跑的倾斜和反光（`cardDeps.glare`）。
   * 它**不是**效果档位的一部分——档位按 GPU 能力分，这一条按玩家的意愿分，
   * 高端机上照样可能是开着的。
   */
  reducedMotion: boolean
  /** 牌背。`FoeHand` 只要这一张，别的组件用不到。 */
  back: Texture
  /**
   * 卡跟不跟指针倾斜（手牌抬起来那张、战场小卡）。
   *
   * 和 `cardDeps.glare` 是同一个物理模型的两半，判据也一样：效果档位开着、而且玩家没要求
   * 「减少动效」。摆出来是因为要它的有两处（`interaction/handPointer` 和 `scenes/duel/tileHover`），
   * 各算一遍迟早走岔。
   */
  cardTilt: boolean
  /** 建卡要的那几样。预热和对局共用同一份，两条路建出来的卡才是一样的。 */
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
  /**
   * 建出来的卡下面要不要垫一团投影。不给就按效果档位定（`TIER_CONFIG[tier].cardShadow`）。
   *
   * 和 `glare` 同一个道理：构筑页一屏二三十张卡，每张多铺一层比卡还大的半透明贴图，
   * 过度绘制（3.2）当场翻倍，而那一页的卡是平铺在格子里的，本来也没有"浮起来"的语义。
   */
  cardShadow?: boolean
  /** 见 `DuelDeps.reducedMotion`。不给就是没开。 */
  reducedMotion?: boolean
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
  const reducedMotion = options.reducedMotion === true
  return {
    baked,
    text,
    animator: new Animator(options.wake),
    platform: options.platform ?? createFakePlatform(),
    clickSound: null,
    rng: new Rng(options.seed),
    tier: options.tier,
    reducedMotion,
    cardTilt: !reducedMotion && TIER_CONFIG[options.tier].cardTilt,
    back: options.back,
    cardDeps: {
      baked,
      text,
      // 减少动效时反光层整个不建：它跟着倾斜一起动，而倾斜正是这一档要关掉的东西。
      glare: !reducedMotion && (options.glare ?? TIER_CONFIG[options.tier].glare),
      // 投影是静态的，和"减少动效"无关，所以它只看档位和调用方。
      shadow: options.cardShadow ?? TIER_CONFIG[options.tier].cardShadow,
    },
  }
}

/** 上下文丢失之后把「画出来的」纹理重画一遍（4.3）。图片纹理 Pixi 自己会重传。 */
export function restoreDeps(deps: DuelDeps): void {
  deps.baked.restore()
  deps.text.restore()
}

/** 拆掉这一份依赖建出来的东西。调用方传进来的卡面纹理不归这里管。 */
export function destroyDeps(deps: DuelDeps): void {
  deps.animator.destroy()
  deps.baked.destroy()
  deps.text.destroy()
}
