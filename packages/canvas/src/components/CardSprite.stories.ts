/**
 * 组件目录页条目：一张卡（7.1 第 3 条）。
 *
 * 状态矩阵（7.1 第 3 条要求的五态）：
 *   普通    「正面」「背面」
 *   悬停    「悬停：倾斜加高光」——扇形里被抬起的那张才跟着指针倾斜、才有反光
 *   按下    不适用。按下去就是拖拽的起手，那是 interaction/handPointer 的事，卡本身没有按下态
 *   禁用    不适用。费用不够、不是自己回合这些判断在场景里做，卡本身不画禁用的样子
 *   加载    不适用。卡是拿着已经加载好的纹理建出来的，建不出来就没有这张卡
 *
 * 演示代码（下面那几个 mount）只在这个文件里，不进 CardSprite——
 * 组件不该为了被展示而多长出一个方法。舞台由装配层搭，约定见 ../storyStage.ts。
 *
 * title 和导出名一律用英文：Storybook 拿它们拼 story id，而截图回归的基线图**按 story id 命名**
 * （见 client/dev/storybook/catalog.spec.ts）。中文进文件名在三个平台上的编码不一致，
 * 基线一换机器就对不上。给人看的中文名写在每条的 `name` 里。
 */

import { bakeTextures } from '../fx/bakedTextures'
import { type EffectTier, TIER_CONFIG } from '../fx/effectTier'
import { CARD_HEIGHT } from '../layout/fanMath'
import { TextTextureCache } from '../runtime/textCache'
import { cardVisualOf } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { CardSprite } from './CardSprite'
import { CardTilt } from './cardTilt'

/** 画布尺寸：一张 150×225 的卡放大 1.6 倍看细节，四周留白。 */
const SIZE = { width: 320, height: 420 }
/** 展示用的放大倍数。和 hover 的 1.9 倍不是一回事，这里只是为了看清印刷细节。 */
const SHOWCASE_SCALE = 1.6
/** 倾斜和反光按时间常数指数收敛，600ms 是跟随时间常数的五倍多，足够停稳。 */
const SETTLE_MS = 600
/** 指针压在卡面左上偏一点的位置。写死才有确定性——截图要的是同一个倾斜角。 */
const POINTER = { rx: 0.3, ry: 0.28 }

/**
 * 把一张卡摆到画布中央，顺便把这条 story 自己建的纹理交出去等着被收。
 *
 * 每条 story 各烤各的：预烤纹理和文字缓存都绑在渲染器上，而每重建一次舞台就换一个新渲染器。
 * 这几张纹理很小，重复烤的代价远低于跨条目共享带来的生命周期麻烦。
 */
function showcase(ctx: StoryStage, tier: EffectTier) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const key = Object.keys(textures.faces)[0]
  const face = key === undefined ? undefined : textures.faces[key]
  if (key === undefined || face === undefined) throw new Error('图集里一张卡面都没有')

  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const card = new CardSprite(cardVisualOf(key, 0, face, textures.back), {
    baked,
    text,
    glare: TIER_CONFIG[tier].glare,
  })
  // 卡的原点在底边中点（见 CardSprite 的坐标约定），所以要往下挪半张卡才是居中。
  card.position.set(ctx.width / 2, ctx.height / 2 + (CARD_HEIGHT * SHOWCASE_SCALE) / 2)
  card.scale.set(SHOWCASE_SCALE)
  ctx.stage.addChild(card)

  return {
    card,
    dispose: () => {
      baked.destroy()
      text.destroy()
    },
  }
}

/** 建一张卡，让它跟着一个固定的指针位置倾斜。倾斜和反光开不开由档位定。 */
function mountTilted(ctx: StoryStage, tier: EffectTier) {
  const { card, dispose } = showcase(ctx, tier)
  const tilt = new CardTilt(card, TIER_CONFIG[tier].cardTilt)
  tilt.setPointer(POINTER.rx, POINTER.ry)
  ctx.onFrame((deltaMs) => tilt.advance(deltaMs))
  return dispose
}

/** 一条倾斜条目的 `parameters.pixi`。三个档位只差一个参数，拼一次省得抄三遍。 */
function tiltedSpec(tier: EffectTier) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mountTilted(ctx, tier),
    },
  }
}

export default {
  title: 'Canvas/CardSprite',
  // 画面全由 Pixi 画，React 这边什么都不渲染：preview 的装饰器会把这条整个换成画布。
  render: () => null,
}

/** 普通态：正面朝上，不倾斜。 */
export const Front = {
  name: '正面',
  parameters: {
    pixi: { ...SIZE, needsAtlas: true, mount: (ctx: StoryStage) => showcase(ctx, 'high').dispose },
  },
}

/** 普通态：背面朝上。翻到 180°，牌背要左右对调才不是镜像的（见 cardProjection）。 */
export const Back = {
  name: '背面',
  parameters: {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      mount: (ctx: StoryStage) => {
        const { card, dispose } = showcase(ctx, 'high')
        card.setFlipAngle(180)
        return dispose
      },
    },
  },
}

/**
 * 翻到 62° 的那一帧：卡已经明显侧过去、还没跨过 90° 那条正反面硬切线。
 * 直接设角度而不是走补间，因为要的就是「停在这个角度」这一张图。
 */
export const FlipMidway = {
  name: '翻面中途',
  parameters: {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      mount: (ctx: StoryStage) => {
        const { card, dispose } = showcase(ctx, 'high')
        card.setFlipAngle(62)
        return dispose
      },
    },
  },
}

/** 悬停态：指针压在卡面上，卡跟着倾斜，覆膜上那一小块反光亮起来。 */
export const HoverTiltGlare = {
  name: '悬停：倾斜加高光',
  parameters: tiltedSpec('high'),
}

/** 低档：不倾斜、连反光层都不建（TIER_CONFIG.low 的 cardTilt 和 glare 都是 false）。 */
export const TierLow = {
  name: '档位：低',
  parameters: tiltedSpec('low'),
}

/** 中档：倾斜和反光都开。 */
export const TierMid = {
  name: '档位：中',
  parameters: tiltedSpec('mid'),
}

/**
 * 高档。卡牌这一层上高档和中档的配置一模一样（差别在命中特效的粒子数），
 * 所以这两张图现在应该长得一样。留着它是为了档位一分家就当场看得出来。
 */
export const TierHigh = {
  name: '档位：高',
  parameters: tiltedSpec('high'),
}
