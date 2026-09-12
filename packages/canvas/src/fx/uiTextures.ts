/**
 * 界面零件那批预烤纹理：匾额的五层、渐隐带、圆章、药丸、铭牌、费用章、星芒、箭头。
 *
 * 和 `bakedTextures.ts` 是同一件事的两半——那边是**卡牌**要的几张，这边是**界面**要的一批。
 * 分成两个对象是因为它们的生命周期不一样：卡牌那批只有对局场景要，界面这批首页、组牌、
 * 房间页都要。谁建场景谁烤一次，动画期间一次都不烤（6.9 的「动画期间纹理上传次数 = 0」）。
 *
 * 每张纹理都是**白色的**，用的时候靠 tint 和 alpha 上色。这样十二套匾额配色只占五张纹理，
 * 换变体、换状态只写属性不重建对象（3.10），全场的界面零件还能合进同一批（3.9）。
 *
 * 形状的画法在四个 *Shapes.ts 里，这里只管「烤、丢了重画、销毁」这三件事。
 */

import { Rectangle, type Renderer, type Texture } from 'pixi.js'
import {
  COST_BADGE_SIZE,
  drawCostBadge,
  drawNameplate,
  drawPillFill,
  drawPillLine,
  drawSealDisc,
  drawSealRing,
} from './badgeShapes'
import { drawRamp } from './frameShapes'
import { drawBackArrow, drawSparkle } from './homeShapes'
import { type Mold, mold } from './mold'
import {
  drawPlaqueCorner,
  drawPlaqueEdge,
  drawPlaqueRim,
  drawPlaqueSpark,
  drawPlaqueSurface,
} from './plaqueShapes'

/** 费用圆章那份模具没有自带取景框（它本来是画在卡面上的），在这里补一个。 */
const costBadgeMold = (): Mold => {
  // 向上取整，免得非整数尺寸在缩放时多糊半个像素。三圈描边都画在直径以内，不会被切。
  const size = Math.ceil(COST_BADGE_SIZE)
  return mold(size, size, drawCostBadge())
}

/**
 * 每张纹理对应一个模具。加一张就在这里加一行，下面三个方法全是按这张表遍历的。
 *
 * 键名就是使用方拿纹理时写的字段名，所以起名按「哪个零件的哪一层」来，别按页面。
 */
const MOLDS = {
  /** 匾额的板面（八角形填充）。 */
  plaqueSurface: drawPlaqueSurface,
  /** 匾额的外框描边。 */
  plaqueEdge: drawPlaqueEdge,
  /** 匾额的两道内框细线。 */
  plaqueRim: drawPlaqueRim,
  /** 匾额四角的折线。 */
  plaqueCorner: drawPlaqueCorner,
  /** 匾额左右两颗星芒。 */
  plaqueSpark: drawPlaqueSpark,
  /** 一条横向的透明度渐变带，分隔线两端的淡出靠它。 */
  ramp: drawRamp,
  /** 夜色圆章的底。 */
  sealDisc: drawSealDisc,
  /** 夜色圆章的外圈。 */
  sealRing: drawSealRing,
  /** 角标药丸的底，按九宫格横向拉伸（切边见 badgeShapes 的 PILL_INSET）。 */
  pillFill: drawPillFill,
  /** 角标药丸的描边，同样按九宫格拉伸。 */
  pillLine: drawPillLine,
  /** 单独一枚卡面铭牌。 */
  nameplate: drawNameplate,
  /** 费用圆章的盘底和外圈。 */
  costBadge: costBadgeMold,
  /** 夜色页面上那颗四角星（花饰的中点、首页导航的分隔）。 */
  sparkle: drawSparkle,
  /** 返回按钮那支左向箭头。 */
  backArrow: drawBackArrow,
} satisfies Record<string, () => Mold>

export type UiTextureKey = keyof typeof MOLDS

export type UiTextures = Record<UiTextureKey, Texture> & {
  /**
   * 重画一遍（4.3：WebGL 上下文丢失之后）。
   * 同 bakedTextures：写回的是同一批 Texture 对象，场景里挂着它们的精灵一个都不用改。
   */
  restore(): void
  destroy(): void
}

/**
 * 烤出界面零件要的那一批纹理。
 *
 * resolution 跟着渲染倍率走：这些纹理会被拉到比模具大（匾额从 224 拉到 224，
 * 圆章从 64 缩到 22），按 1 倍烤在高 DPI 屏上会糊。
 */
export function bakeUiTextures(renderer: Renderer): UiTextures {
  const resolution = renderer.resolution
  // 模具留着不扔，为的是上下文丢失之后能照原样再画一遍（同 bakedTextures 的做法）。
  const molds = Object.fromEntries(
    Object.entries(MOLDS).map(([key, draw]) => [key, draw()]),
  ) as Record<UiTextureKey, Mold>

  const textures = Object.fromEntries(
    Object.entries(molds).map(([key, m]) => [
      key,
      renderer.generateTexture({
        target: m.graphics,
        // 取景框写死，同一个零件拆出来的几层才对得齐，理由见 mold.ts。
        frame: new Rectangle(0, 0, m.width, m.height),
        resolution,
        antialias: true,
      }),
    ]),
  ) as Record<UiTextureKey, Texture>

  const keys = Object.keys(MOLDS) as UiTextureKey[]
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
