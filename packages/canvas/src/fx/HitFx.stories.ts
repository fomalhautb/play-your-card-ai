/**
 * 组件目录页条目：卡牌落地的命中特效（7.1 第 3 条）。
 *
 * 拍的是**播放中的一帧**：整段演出 0.8 秒，停在 250ms 那一帧上——
 * 那时烟尘已经扑开、追光跑到侧边、震屏还在最后一段位移里，三样东西同时看得见。
 * 手动时钟保证每次都停在同一帧，截图才比得动（6.6）。
 *
 * 状态矩阵：特效没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 * 它自己的"变体"是三个效果档位（3.7），也就是下面三条。
 *
 * 命名和 title 用英文的理由见 components/CardSprite.stories.ts 的文件头。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import { CardSprite } from '../components/CardSprite'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import { Rng } from '../runtime/rng'
import { TextTextureCache } from '../runtime/textCache'
import { cardVisualOf } from '../scenes/deckCards'
import type { StoryStage } from '../storyStage'
import { bakeTextures } from './bakedTextures'
import type { EffectTier } from './effectTier'
import { HitFx } from './HitFx'

/** 画布尺寸。烟尘往两侧扑出去五十来像素、往上腾三十几，四周得留得开。 */
const SIZE = { width: 460, height: 420 }
/** 停在哪一帧。整段 0.8 秒，250ms 时烟尘、追光、震屏三样都在。 */
const SETTLE_MS = 250
/** 落地的卡缩到战场尺寸，和真出牌落地时一样大（duelLayout 的 boardScale 也读这个令牌）。 */
const BOARD_SCALE = tokens.size.card.tileScale
/** 烟尘方向和大小的随机种子。写死才有确定性（6.9 的前提）。 */
const SEED = 20260908

/**
 * 摆一张落在战场上的卡，然后对它播一次命中特效。
 *
 * 层级和真场景一样：战场层在下、特效层在上，震屏抖的是这两层的共同父节点
 * （对应 duelPrototype 里的 worldRoot），烟尘才盖得住卡的下沿。
 */
function mountHit(ctx: StoryStage, tier: EffectTier) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const key = Object.keys(textures.faces)[0]
  const face = key === undefined ? undefined : textures.faces[key]
  if (key === undefined || face === undefined) throw new Error('图集里一张卡面都没有')

  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const world = new Container()
  const boardLayer = new Container()
  const fxLayer = new Container()
  world.addChild(boardLayer, fxLayer)
  ctx.stage.addChild(world)

  const card = new CardSprite(cardVisualOf(key, 0, face, textures.back), {
    baked,
    text,
    glare: false,
  })
  const center = { x: ctx.width / 2, y: ctx.height / 2 }
  // 卡的原点在底边中点，所以摆到中心要往下补半张卡。
  card.position.set(center.x, center.y + (CARD_HEIGHT * BOARD_SCALE) / 2)
  card.scale.set(BOARD_SCALE)
  boardLayer.addChild(card)

  const fx = new HitFx({
    layer: fxLayer,
    shakeTarget: world,
    animator: ctx.animator,
    baked,
    rng: new Rng(SEED),
    tier,
  })
  fx.play({
    x: center.x,
    y: center.y,
    width: CARD_WIDTH * BOARD_SCALE,
    height: CARD_HEIGHT * BOARD_SCALE,
  })

  return () => {
    baked.destroy()
    text.destroy()
  }
}

/** 一条条目的 `parameters.pixi`。三条只差档位。 */
function hitSpec(tier: EffectTier) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mountHit(ctx, tier),
    },
  }
}

export default {
  title: 'Canvas/HitFx',
  render: () => null,
}

/** 低档：3 团烟尘，没有边缘追光（TIER_CONFIG.low 的 edgeLight 是 false）。 */
export const TierLow = {
  name: '档位：低（3 团烟尘）',
  parameters: hitSpec('low'),
}

/** 中档：5 团烟尘加追光，和旧版 DOM 那套的团数一致。 */
export const TierMid = {
  name: '档位：中（5 团烟尘）',
  parameters: hitSpec('mid'),
}

/** 高档：9 团烟尘加追光。 */
export const TierHigh = {
  name: '档位：高（9 团烟尘）',
  parameters: hitSpec('high'),
}
