/**
 * 卡牌那一批建场景时烤一次、之后再不改的纹理：柔光圆点、卡面边框、卡下阴影、
 * 八角雕花匾、兜底文字层的渐变、问号圆章、费用圆章的盘底和金属圈、对手的隐藏牌背。
 *
 * 为什么要烤，而不是直接把 Graphics 挂进场景：
 * - 3.1 不许挂 Filter，所以"发光""羽化""投影"这类软边只能靠一张自带渐变的纹理去画；
 * - 3.9 要求合批不被打断，而 Graphics 每换一次几何就是一次单独的绘制，
 *   十几张牌各画一份边框就是十几次；烤成一张共享纹理之后所有牌的同一层能合进同一批。
 * - 3.4 说卡面走图集，边框、匾额这类"每张牌都一样"的东西同理，只是它由代码生成而不是美术出图。
 *
 * **这一批全部是全场共享的**：屏幕上多摆一张牌不会多出一张纹理，跑批里那条
 * 「合批被打断次数」（实际量的是这一帧有多少张不同纹理）只加常数，不随卡数涨。
 * 往这张表里加东西之前先想清楚它能不能共享，不能共享就不该进来。
 *
 * 烤纹理会走离屏渲染，所以只在建场景时烤一次，动画期间一次都不烤
 * ——6.9 的「动画期间纹理上传次数 = 0」靠这个时机保证。
 *
 * 和 `uiTextures.ts` 是同一件事的两半：那边是**界面零件**要的一批，这边是**卡牌**要的。
 * 分成两个对象是因为生命周期不一样：卡牌这批对局和组牌页要，界面那批到处都要。
 * 形状的画法在 `cardShapes.ts` / `cardPlaque.ts` / `badgeShapes.ts` 里，这里只管
 * 「烤、丢了重画、销毁」这三件事。
 */

import { Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js'
import { drawCostDisc, drawCostRings } from './badgeShapes'
import {
  drawCardBody,
  drawCardChrome,
  drawCardSeal,
  drawCardShadow,
  drawFoeBack,
} from './cardShapes'
import { type Mold, mold } from './mold'

/** 柔光圆点的贴图边长。64 足够：它永远被放大成一团糊边的光，采样精度用不上更多。 */
const SOFT_DOT_SIZE = 64
/** 柔光圆点的渐变层数。层数越多边缘越顺，12 层在 64px 上已经看不出台阶。 */
const SOFT_DOT_RINGS = 12

/**
 * 每张纹理对应一个模具。加一张就在这里加一行，下面三个方法全是按这张表遍历的。
 * 键名就是使用方拿纹理时写的字段名。
 */
const MOLDS = {
  /** 中心实、边缘透明的一团柔光。落地的烟尘用它，靠 tint 和缩放变样子。 */
  softDot: drawSoftDot,
  /** 卡面那圈 1px 米白边和它内侧的双层羽化带。 */
  cardChrome: () => drawCardChrome(false),
  /**
   * 同上，外加卡面下部那块八角雕花匾（不含上面的两行字）。
   * 具名 AI 牌用这一张替掉 `cardChrome`——合成一张是为了不多占一层，理由见 cardShapes.ts。
   */
  cardChromePlaque: () => drawCardChrome(true),
  /** 卡下那团软阴影，比卡面大出一圈。 */
  cardShadow: drawCardShadow,
  /** 查不到专属原画时压在卡底的那层渐变遮罩。 */
  cardBody: drawCardBody,
  /** 能翻面的牌右上角那枚问号圆章的底和圈（问号本身是文字纹理）。 */
  cardSeal: drawCardSeal,
  /** 费用圆章的盘底，白色，逐张按盘底色 tint。 */
  costDisc: drawCostDisc,
  /** 费用圆章的三圈金属环和上下两道弧线。 */
  costRings: drawCostRings,
  /** 对手手牌的隐藏牌背：纸白底 + 内圈细边 + 藏青纹章。 */
  foeBack: drawFoeBack,
} satisfies Record<string, () => Mold>

type BakedTextureKey = keyof typeof MOLDS

export type BakedTextures = Record<BakedTextureKey, Texture> & {
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
   * 几个小 Graphics 的几何数据加起来不到几十 KB，比"丢了就没法恢复"划算得多。
   */
  const molds = Object.fromEntries(
    Object.entries(MOLDS).map(([key, draw]) => [key, draw()]),
  ) as Record<BakedTextureKey, Mold>

  const textures = Object.fromEntries(
    Object.entries(molds).map(([key, m]) => [
      key,
      renderer.generateTexture({
        target: m.graphics,
        // 取景框写死，不让 Pixi 按包围盒算：描边和填充的包围盒天生不一样大，理由见 mold.ts。
        frame: new Rectangle(0, 0, m.width, m.height),
        // 个别模具要按更高的倍率烤（取景框比画出来的细节大得多），见 mold.ts 的 resolution。
        resolution: resolution * (m.resolution ?? 1),
        antialias: true,
      }),
    ]),
  ) as Record<BakedTextureKey, Texture>

  const keys = Object.keys(MOLDS) as BakedTextureKey[]
  return {
    ...textures,
    restore() {
      for (const key of keys) {
        renderer.render({ container: molds[key].graphics, target: textures[key], clear: true })
      }
    },
    destroy() {
      for (const key of keys) {
        textures[key].destroy(true)
        molds[key].graphics.destroy()
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
function drawSoftDot(): Mold {
  const g = new Graphics()
  const radius = SOFT_DOT_SIZE / 2
  for (let i = SOFT_DOT_RINGS; i >= 1; i -= 1) {
    const t = i / SOFT_DOT_RINGS
    // alpha 按 (1−t)² 收：线性的话中心太平，看着像一块饼而不是一团光。
    g.circle(radius, radius, radius * t).fill({ color: 0xffffff, alpha: (1 - t) ** 2 * 0.9 + 0.02 })
  }
  return mold(SOFT_DOT_SIZE, SOFT_DOT_SIZE, g)
}
