/**
 * 边框和吊匾的模具：雕花框的角、渐隐带、「下一题」纸匾、「对方回合」吊匾。
 *
 * 和 plaqueShapes 一样的规矩：每一层都画成白色，用的时候靠 tint 上色。
 * 分层的依据是**颜色**——同一张纹理只能 tint 成一种颜色，所以外框线（深）和内框线（浅）
 * 必须分开烤；而颜色相同、只是浓淡不同的（纸匾上那几笔卷草）把 alpha 直接画进纹理就行，
 * 没必要多占一张。
 *
 * 路径全部抄自旧版：雕花框的角是 `styles.css` 的 `.ornate-frame__corner` 一族，
 * 两块吊匾是 `ui/MatchStage.tsx` 里那几条 PLAQUE_* 常量。走的是 Pixi 的 GraphicsPath，
 * 它认 SVG 的路径数据字符串，所以形状和旧版是同一份而不是照着描的。
 * 旧版还给它们套了手绘位移滤镜，这里没有——3.1 不许挂 Filter。
 */

import { Graphics, GraphicsPath } from 'pixi.js'
import { type Mold, mold } from './mold'

/** 雕花框四角那组装饰的边长，和 `size.frame.corner` 是同一个数。 */
const CORNER = 38
/**
 * 角纹理四周留的空白。
 *
 * 旧版内层那道 L 是绕 (14, 14) 转 45° 得到的，转完之后左端点跑到 x ≈ −2.26，
 * 也就是探到「角」这个盒子外面去了（CSS 里没有 overflow: hidden，旧版看得见这一截）。
 * 留 4px 的边它才装得进纹理。
 */
const CORNER_PAD = 4
const CORNER_SIZE = CORNER + CORNER_PAD * 2

/** 绕 (ox, oy) 转 45°。旧版是 CSS 的 `transform: rotate(45deg)`，这里自己算。 */
function rotate45(x: number, y: number, ox: number, oy: number): [number, number] {
  const k = Math.SQRT1_2
  const dx = x - ox
  const dy = y - oy
  return [ox + (dx - dy) * k, oy + (dx + dy) * k]
}

/**
 * 雕花框角的外层：一道 L 形折角，加角上那颗菱形的描边。
 *
 * 只画描边不画菱形的底：旧版给它填了不透明底色是为了盖住穿过去的内层线，
 * 而这里两条线都不经过菱形所在的位置（内层 L 转完之后离它还有十几个像素），
 * 填了反而会在纸底上留一块色差。
 */
export function drawFrameCornerOuter(): Mold {
  const g = new Graphics()
  const p = CORNER_PAD
  g.moveTo(p + CORNER, p)
    .lineTo(p, p)
    .lineTo(p, p + CORNER)
  // 菱形：6×6 的方块绕自己中心转 45°，也就是半对角线 3√2 的一颗钻。
  const half = 3 * Math.SQRT2
  const cx = p + 20
  const cy = p + 20
  g.moveTo(cx, cy - half)
    .lineTo(cx + half, cy)
    .lineTo(cx, cy + half)
    .lineTo(cx - half, cy)
    .closePath()
  return mold(CORNER_SIZE, CORNER_SIZE, g.stroke({ width: 1, color: 0xffffff }))
}

/** 雕花框角的内层：23×23 的 L 绕 (14, 14) 转 45°，看着像一枚斜置的箭头。 */
export function drawFrameCornerInner(): Mold {
  const g = new Graphics()
  const p = CORNER_PAD
  const [ax, ay] = rotate45(7, 7, 14, 14)
  const [bx, by] = rotate45(30, 7, 14, 14)
  const [cx, cy] = rotate45(7, 30, 14, 14)
  g.moveTo(p + bx, p + by)
    .lineTo(p + ax, p + ay)
    .lineTo(p + cx, p + cy)
  return mold(CORNER_SIZE, CORNER_SIZE, g.stroke({ width: 1, color: 0xffffff }))
}

/** 渐隐带的采样段数。32 段被拉到几百像素宽之后仍然看不出台阶。 */
const RAMP_STEPS = 32

/**
 * 一条从全透明渐变到全不透明的白带，横向。
 *
 * 分隔线两端的淡出全靠它：贴一张往右渐显的图，再贴一张左右翻转的，中间就是最实的一段。
 * 不用 Graphics 的渐变填充——那条路在不同后端上的插值不完全一致（4.4 要求各浏览器一样），
 * 而一排纯色方块的结果是确定的（同 bakedTextures 里那团柔光）。
 */
export function drawRamp(): Mold {
  const g = new Graphics()
  for (let i = 0; i < RAMP_STEPS; i += 1) {
    g.rect(i, 0, 1, 1).fill({ color: 0xffffff, alpha: (i + 1) / RAMP_STEPS })
  }
  return mold(RAMP_STEPS, 1, g)
}

/** 「下一题」纸匾的设计尺寸，也是旧版那段 SVG 的 viewBox。 */
export const NEXT_PLAQUE_BASE = { width: 168, height: 118 }

const NEXT_OUTLINE =
  'M22 6H146C155 6 162 13 162 22V96C162 105 155 112 146 112H22C13 112 6 105 6 96V22C6 13 13 6 22 6Z'
const NEXT_MID =
  'M25 11H143C151 11 157 17 157 25V93C157 101 151 107 143 107H25C17 107 11 101 11 93V25C11 17 17 11 25 11Z'
const NEXT_INNER =
  'M28 15H140C147 15 153 21 153 28V90C153 97 147 103 140 103H28C21 103 15 97 15 90V28C15 21 21 15 28 15Z'
const NEXT_CORNER_ARC = 'M18 34C18 25 25 18 34 18'
const NEXT_CORNER_LEAF = 'M23 31C25 25 29 22 34 23C30 26 26 30 24 34Z'
const NEXT_CREST_GEM = 'M84 0L89.5 6L84 12L78.5 6Z'
const NEXT_CREST_WING = 'M66 6C71 1 76.5 2 78 6M102 6C97 1 91.5 2 90 6'
const NEXT_STUDS = 'M6 53L10 59L6 65L2 59ZM162 53L166 59L162 65L158 59Z'

/**
 * 四个角的卷草各摆一份，用镜像不用旋转。
 *
 * 旧版的注释写明了理由：旋转会让卷曲方向绕着圈走，四个角看起来像在转风车。
 * 每一项是 [sx, sy]，负号表示那一轴翻转。
 */
const CORNER_MIRRORS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]

/**
 * 在镜像坐标系里再画一遍。
 *
 * 做法是挂一个子 Graphics 并给它设 scale——翻转轴上还要补一次平移，
 * 否则图形会被翻到匾外面去。烤纹理时子节点跟着一起渲染，所以这样是有效的。
 */
function mirrored(parent: Graphics, sx: number, sy: number, draw: (g: Graphics) => void): void {
  const { width, height } = NEXT_PLAQUE_BASE
  const child = new Graphics()
  draw(child)
  child.scale.set(sx, sy)
  child.position.set(sx < 0 ? width : 0, sy < 0 ? height : 0)
  parent.addChild(child)
}

/** 纸匾的底纸：外轮廓、上下两颗冠饰宝石、左右两枚铆钉，都是同一档纸色。 */
export function drawNextPlaquePaper(): Mold {
  const g = new Graphics().path(new GraphicsPath(NEXT_OUTLINE)).fill({ color: 0xffffff })
  for (const sy of [1, -1]) {
    mirrored(g, 1, sy, (p) => {
      p.path(new GraphicsPath(NEXT_CREST_GEM)).fill({ color: 0xffffff })
    })
  }
  g.path(new GraphicsPath(NEXT_STUDS)).fill({ color: 0xffffff })
  return mold(NEXT_PLAQUE_BASE.width, NEXT_PLAQUE_BASE.height, g)
}

/**
 * 纸匾上归外框色的那一层：两道框线、四角卷草、冠饰和铆钉的描边。
 *
 * 卷草那两笔的透明度（0.8 / 0.72）直接画进纹理：它们和框线同色、只有浓淡不同。
 */
export function drawNextPlaqueRim(): Mold {
  const g = new Graphics()
  g.path(new GraphicsPath(NEXT_OUTLINE)).stroke({ width: 1.6, color: 0xffffff })
  g.path(new GraphicsPath(NEXT_MID)).stroke({ width: 1, color: 0xffffff })
  for (const [sx, sy] of CORNER_MIRRORS) {
    mirrored(g, sx, sy, (p) => {
      p.path(new GraphicsPath(NEXT_CORNER_ARC)).stroke({
        width: 1.1,
        color: 0xffffff,
        alpha: 0.8,
      })
      p.path(new GraphicsPath(NEXT_CORNER_LEAF)).fill({ color: 0xffffff, alpha: 0.72 })
    })
  }
  for (const sy of [1, -1]) {
    mirrored(g, 1, sy, (p) => {
      p.path(new GraphicsPath(NEXT_CREST_GEM)).stroke({ width: 1.4, color: 0xffffff })
      p.path(new GraphicsPath(NEXT_CREST_WING)).stroke({ width: 1.1, color: 0xffffff })
    })
  }
  g.path(new GraphicsPath(NEXT_STUDS)).stroke({ width: 1.1, color: 0xffffff })
  return mold(NEXT_PLAQUE_BASE.width, NEXT_PLAQUE_BASE.height, g)
}

/** 纸匾最里面那道发丝线。旧版单独退了一档颜色，所以它自己占一张纹理。 */
export function drawNextPlaqueHair(): Mold {
  const g = new Graphics()
    .path(new GraphicsPath(NEXT_INNER))
    .stroke({ width: 0.7, color: 0xffffff })
  return mold(NEXT_PLAQUE_BASE.width, NEXT_PLAQUE_BASE.height, g)
}

/** 「对方回合」吊匾的设计尺寸，也是旧版那段 SVG 的 viewBox。 */
export const TURN_PLAQUE_BASE = { width: 252, height: 66 }
/** 匾体圆角。旧版匾体是 9，外框那条 rect 是 8.25——描边有一半压在外面，看到的正好对齐。 */
const TURN_PLAQUE_RADIUS = 9

/** 吊匾的匾体：一块圆角矩形。 */
export function drawTurnPlaqueBody(): Mold {
  const { width, height } = TURN_PLAQUE_BASE
  const g = new Graphics()
    .roundRect(0, 0, width, height, TURN_PLAQUE_RADIUS)
    .fill({ color: 0xffffff })
  return mold(width, height, g)
}

/** 吊匾的外框线。旧版把它拆成单独一层 SVG，是为了套滤镜时里面的字不跟着抖歪。 */
export function drawTurnPlaqueFrame(): Mold {
  const { width, height } = TURN_PLAQUE_BASE
  const g = new Graphics()
    .roundRect(0.75, 0.75, width - 1.5, height - 1.5, TURN_PLAQUE_RADIUS - 0.75)
    .stroke({ width: 1.5, color: 0xffffff })
  return mold(width, height, g)
}
