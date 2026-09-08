/**
 * 八角匾额按钮（需求单按钮 A~D）的五层模具。
 *
 * 为什么拆成五层而不是一张图：四个变体（墨蓝、纸白、陶橙、米白）× 三个状态
 *（默认、悬停、禁用）一共十二套配色，一套烤一张就是十二张纹理，而且换状态要换纹理
 *（=换合批）。拆成板面 / 外框 / 内框 / 四角 / 星芒五层之后，每一层都是**白色**的，
 * 上色全靠 tint 和 alpha——换变体、换状态只写这两个属性，不重建任何东西（3.10），
 * 五张纹理全场共用一份，所有按钮合进同一批（3.9）。
 *
 * 路径直接抄旧版 `ui/PlaqueButton.tsx` 那段内联 SVG（同一个 224×68 的 viewBox），
 * Pixi 的 GraphicsPath 认 SVG 的路径字符串，所以形状是一模一样的，不是照着描的。
 * 旧版 SVG 是 `preserveAspectRatio="none"`，也就是整块按变体的宽高**拉伸**；
 * 这边用一张 224×68 的纹理非等比缩放，效果一致（描边跟着一起变粗细）。
 *
 * 旧版整块还套了一层 `#ai-duel-rough-button` 手绘位移滤镜，这里没有：3.1 不许挂 Filter。
 * 手绘感将来要靠把抖动烤进纹理（在模具里就画歪），不靠运行时滤镜。
 */

import { Graphics, GraphicsPath } from 'pixi.js'
import { type Mold, mold } from './mold'

/** 模具的基准尺寸，也是旧版那段 SVG 的 viewBox。所有按钮都是这张图拉伸出来的。 */
export const PLAQUE_BASE = { width: 224, height: 68 }

/**
 * 板面的八角轮廓，就是旧版 `.plaque-button` 那条 clip-path。
 *
 * 不复用下面 `SURFACE_PATH`（外框描边那条）来当板面：那条路径整体往里缩了 1.5px，
 * 拿它填色的话底色会比按钮实际占的地方小一圈，四个切角处会露出背景。
 * 百分比换算过来的点：5.5% / 94.5% 换成 x，18% / 82% 换成 y。
 */
const OCTAGON: number[] = (() => {
  const { width: w, height: h } = PLAQUE_BASE
  const cut = { x: w * 0.055, y: h * 0.18 }
  return [
    cut.x,
    0,
    w - cut.x,
    0,
    w,
    cut.y,
    w,
    h - cut.y,
    w - cut.x,
    h,
    cut.x,
    h,
    0,
    h - cut.y,
    0,
    cut.y,
  ]
})()

/** 外框：八角形的一圈描边，宽 2。 */
const SURFACE_PATH =
  'M12 1.5h200c3 0 5 1 7 3l2 2c2 2 2.5 4 2.5 7v41c0 3-.5 5-2.5 7l-2 2c-2 2-4 3-7 3H12' +
  'c-3 0-5-1-7-3l-2-2c-2-2-2.5-4-2.5-7v-41c0-3 .5-5 2.5-7l2-2c2-2 4-3 7-3Z'

/** 内框两道细线，宽 1。由外到内各缩一档。 */
const RIM_PATHS = [
  'M12 4.5h199c3 0 4.5.75 6.5 2.75l1.25 1.25c1.75 1.75 2.25 3.5 2.25 6v39c0 2.5-.5 4.25-2.25 6' +
    'l-1.25 1.25c-2 2-3.5 2.75-6.5 2.75H12c-3 0-4.5-.75-6.5-2.75L4.25 59.5C2.5 57.75 2 56 2 53.5' +
    'v-39c0-2.5.5-4.25 2.25-6L5.5 7.25c2-2 3.5-2.75 6.5-2.75Z',
  'M14 8h196c2.5 0 4 .75 5.5 2.25l.25.25c1.5 1.5 2 3 2 5.5v36c0 2.5-.5 4-2 5.5l-.25.25' +
    'C214 59.25 212.5 60 210 60H14c-2.5 0-4-.75-5.5-2.25l-.25-.25c-1.5-1.5-2-3-2-5.5V16' +
    'c0-2.5.5-4 2-5.5l.25-.25C10 8.75 11.5 8 14 8Z',
]

/** 四个角上那组折线，宽 1。 */
const CORNER_PATH =
  'M4 15V11l7-7h8M10 6v8H3m11-9v8M220 15v-4l-7-7h-8m9 2v8h7m-11-9v8' +
  'M4 53v4l7 7h8m-9-2v-8H3m11 9v-8M220 53v4l-7 7h-8m9-2v-8h7m-11 9v-8'

/** 左右两颗星芒，实心。 */
const SPARK_PATH =
  'M14 25.5 16 31l5 3-5 3-2 5.5-2-5.5-5-3 5-3 2-5.5Zm196 0 2 5.5 5 3-5 3-2 5.5-2-5.5-5-3 5-3 2-5.5Z'

const base = (): Graphics => new Graphics()
const framed = (graphics: Graphics): Mold => mold(PLAQUE_BASE.width, PLAQUE_BASE.height, graphics)

/** 板面：整块八角形填白，用的时候按变体和状态 tint 成板面色。 */
export function drawPlaqueSurface(): Mold {
  return framed(base().poly(OCTAGON).fill({ color: 0xffffff }))
}

/** 外框描边。 */
export function drawPlaqueEdge(): Mold {
  return framed(base().path(new GraphicsPath(SURFACE_PATH)).stroke({ width: 2, color: 0xffffff }))
}

/** 内框那两道细线。 */
export function drawPlaqueRim(): Mold {
  const g = base()
  for (const path of RIM_PATHS) g.path(new GraphicsPath(path))
  return framed(g.stroke({ width: 1, color: 0xffffff }))
}

/** 四角折线。 */
export function drawPlaqueCorner(): Mold {
  return framed(base().path(new GraphicsPath(CORNER_PATH)).stroke({ width: 1, color: 0xffffff }))
}

/** 左右两颗星芒。 */
export function drawPlaqueSpark(): Mold {
  return framed(base().path(new GraphicsPath(SPARK_PATH)).fill({ color: 0xffffff }))
}
