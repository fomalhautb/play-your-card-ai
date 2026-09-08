/**
 * 建场景时烤一次就不再动的几张纹理：柔光圆点、卡牌边框铭牌、费用圆章。
 *
 * 为什么要烤，而不是直接把 Graphics 挂进场景：
 * - 3.1 不许挂 Filter，所以"发光"这类软边只能靠一张自带渐变的纹理去画；
 * - 3.9 要求合批不被打断，而 Graphics 每换一次几何就是一次单独的绘制，
 *   十几张牌各画一份边框就是十几次；烤成一张共享纹理之后所有牌的边框能合进同一批。
 * - 3.4 说卡面走图集，边框铭牌这类"每张牌都一样"的东西同理，只是它由代码生成而不是美术出图。
 *
 * 烤纹理会走离屏渲染，所以只在 createDuelPrototype 里烤一次，动画期间一次都不烤
 * ——6.9 的「动画期间纹理上传次数 = 0」靠这个时机保证。
 *
 * 全部画成白色/浅色，用的时候靠 tint 上色（tint 不触发重建，符合 3.10）。
 */

import { tokens } from '@ai-duel/design'
import { Graphics, type Renderer, type Texture } from 'pixi.js'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'
import { drawCostBadge, drawNameplateBand, NAMEPLATE_HEIGHT } from './badgeShapes'

/** 柔光圆点的贴图边长。64 足够：它永远被放大成一团糊边的光，采样精度用不上更多。 */
const SOFT_DOT_SIZE = 64
/** 柔光圆点的渐变层数。层数越多边缘越顺，12 层在 64px 上已经看不出台阶。 */
const SOFT_DOT_RINGS = 12

/*
 * 卡面铭牌带的高度、费用圆章的直径和圆心，以及圆章自己的画法，都搬去了 badgeShapes.ts。
 * 那三样在需求单里是独立变体（徽章 A、徽章 C），组牌页和结算层要单独用；
 * 留在这里的话同一个形状会有两份定义，早晚走岔。
 */

export interface BakedTextures {
  /** 中心实、边缘透明的一团柔光。落地的烟尘用它，靠 tint 和缩放变样子。 */
  softDot: Texture
  /** 卡面的边框加底部铭牌带，尺寸就是卡面基准尺寸。 */
  cardChrome: Texture
  /** 费用圆章的盘底和外圈。 */
  costBadge: Texture
  /**
   * 重画一遍（4.3：WebGL 上下文丢失之后）。
   *
   * 这几张是渲染到纹理的产物，上下文一丢内容就是空的，而 Pixi 只会自动重传
   * "有原始数据"的纹理（图片、canvas），画出来的东西它补不回来。
   * 重画写进的是**同一批 Texture 对象**，所以场景里已经引用它们的精灵一个都不用改。
   */
  restore(): void
  destroy(): void
}

/**
 * 烤出场景要用的那几张纹理。
 *
 * resolution 跟着渲染倍率走：这些纹理会被放大到卡面尺寸甚至 hover 的 1.9 倍，
 * 按 1 倍烤在高 DPI 屏上会糊。
 */
export function bakeTextures(renderer: Renderer): BakedTextures {
  const resolution = renderer.resolution
  /*
   * 模具留着不扔，为的是上下文丢失之后能照原样再画一遍（见 restore）。
   * 三个小 Graphics 的几何数据加起来不到几 KB，比"丢了就没法恢复"划算得多。
   */
  const molds = {
    softDot: drawSoftDot(),
    cardChrome: drawCardChrome(),
    costBadge: drawCostBadge(),
  }
  const bake = (graphics: Graphics): Texture =>
    renderer.generateTexture({ target: graphics, resolution, antialias: true })

  const softDot = bake(molds.softDot)
  const cardChrome = bake(molds.cardChrome)
  const costBadge = bake(molds.costBadge)
  const pairs: [Texture, Graphics][] = [
    [softDot, molds.softDot],
    [cardChrome, molds.cardChrome],
    [costBadge, molds.costBadge],
  ]

  return {
    softDot,
    cardChrome,
    costBadge,
    restore() {
      for (const [texture, graphics] of pairs) {
        renderer.render({ container: graphics, target: texture, clear: true })
      }
    },
    destroy() {
      for (const [texture, graphics] of pairs) {
        texture.destroy(true)
        graphics.destroy()
      }
    },
  }
}

/**
 * 一团中心亮、边缘化开的白色光斑。
 *
 * 画法是一圈套一圈的同心圆，每圈都是全白、只有透明度递减，叠出来就是径向渐变。
 * 不用 Graphics 的渐变填充：那条路在不同后端上的插值不完全一致（4.4 要求各浏览器一样），
 * 而一堆纯色圆的结果是确定的。
 */
function drawSoftDot(): Graphics {
  const g = new Graphics()
  const radius = SOFT_DOT_SIZE / 2
  for (let i = SOFT_DOT_RINGS; i >= 1; i -= 1) {
    const t = i / SOFT_DOT_RINGS
    // alpha 按 (1−t)² 收：线性的话中心太平，看着像一块饼而不是一团光。
    g.circle(radius, radius, radius * t).fill({ color: 0xffffff, alpha: (1 - t) ** 2 * 0.9 + 0.02 })
  }
  return g
}

/**
 * 卡面的边框和底部铭牌带。
 *
 * 用的是纸面色板里的卡边米黄和描边色，和旧版 DOM 卡面同一份数（见 design 包）。
 * 只画边框和铭牌带，中间是透空的，卡面原画铺在它下面。
 * 四角的圆角和原画那份是同一个令牌（CARD_RADIUS），三处画卡的地方必须一致。
 */
function drawCardChrome(): Graphics {
  const g = new Graphics()
  const edge = tokens.color.card.edgeTint
  const line = tokens.color.battle.lineDark

  /*
   * 描边路径的圆角要按内缩量减一档：圆角矩形往里缩 k 像素，半径就跟着小 k，
   * 描边的**外沿**才正好落在卡的轮廓上。原画和牌背的圆角是构建期烤进 alpha 的
   * （见 assets/build-atlas.mjs），两边对不上就会露出一小段直角。
   */
  // 外圈描边。画在内侧半个线宽的位置，描边才不会被烤纹理时的边界切掉半条。
  g.roundRect(1.5, 1.5, CARD_WIDTH - 3, CARD_HEIGHT - 3, CARD_RADIUS - 1.5).stroke({
    width: 3,
    color: line,
    alpha: 0.85,
  })
  // 内侧那条细线，旧版卡面上那圈"雕花框"的简化版。
  g.roundRect(6, 6, CARD_WIDTH - 12, CARD_HEIGHT - 12, CARD_RADIUS - 6).stroke({
    width: 1,
    color: edge,
    alpha: 0.55,
  })
  // 底部铭牌带：名字印在这上面，所以要不透明，压住下面的原画。
  // 和单独一枚铭牌（徽章 C）共用同一份画法，见 badgeShapes.ts。
  drawNameplateBand(g, CARD_HEIGHT - 6 - NAMEPLATE_HEIGHT, line)
  return g
}
