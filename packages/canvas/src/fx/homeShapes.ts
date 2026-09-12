/**
 * 夜色页面（首页、选英雄页）那几个零件的模具：四角星、返回箭头。
 *
 * 和 `plaqueShapes` / `frameShapes` / `badgeShapes` 是同一类东西的第四张：
 * 一律画成纯白，用的时候靠 tint 和 alpha 上色（见 uiTextures.ts 的文件头）。
 *
 * 为什么星星要自己画路径而不是用字符 `✦`：那个字符是直边的，设计稿里那颗星的边是**内凹**的；
 * 而且它得指望各系统都装了同一份字体，不装就掉回别的字形（旧版 HomeScreen 的 Sparkle 注释）。
 */

import { Graphics } from 'pixi.js'
import { type Mold, mold } from './mold'

/** 星星和箭头的模具基准边长。烤出来之后按各处要的尺寸缩，画的时候只认这一个坐标系。 */
const SPARKLE_BASE = 40
const ARROW_BASE = { width: 46, height: 30 }

/**
 * 四角星（需求单图标 C）。
 *
 * 路径抄旧版 `HomeScreen.tsx` 的 `Sparkle`（viewBox 0 0 10 10），按基准边长放大。
 * 四条边用三次贝塞尔往内凹，凹点落在中心和顶点之间的三成处——直边画出来是一颗菱形，
 * 内凹之后才是设计稿上那种细长的芒。
 */
export function drawSparkle(): Mold {
  const s = SPARKLE_BASE / 10
  const g = new Graphics()
    .moveTo(5 * s, 0)
    .bezierCurveTo(5.4 * s, 3.2 * s, 6.8 * s, 4.6 * s, 10 * s, 5 * s)
    .bezierCurveTo(6.8 * s, 5.4 * s, 5.4 * s, 6.8 * s, 5 * s, 10 * s)
    .bezierCurveTo(4.6 * s, 6.8 * s, 3.2 * s, 5.4 * s, 0, 5 * s)
    .bezierCurveTo(3.2 * s, 4.6 * s, 4.6 * s, 3.2 * s, 5 * s, 0)
    .closePath()
    .fill({ color: 0xffffff })
  return mold(SPARKLE_BASE, SPARKLE_BASE, g)
}

/**
 * 返回按钮那支左向箭头（需求单按钮 H 里那段内联 SVG，viewBox 0 0 23 15）。
 *
 * 画成**实心**而不是线稿：旧版那条 1.3px 的描边是配着手绘位移滤镜设计的，
 * Pixi 这边不挂 Filter（3.1），细线在小尺寸上会被抗锯齿吃掉大半。
 * 实心的箭头在 16px 高上仍然认得出来，而且和别处的图标一个路数（见需求单按钮 K）。
 */
export function drawBackArrow(): Mold {
  const { width, height } = ARROW_BASE
  const mid = height / 2
  const headX = height * 0.62
  const barTop = mid - height * 0.11
  const g = new Graphics()
    // 箭头那只三角。
    .moveTo(0, mid)
    .lineTo(headX, 0)
    .lineTo(headX, height)
    .closePath()
    .fill({ color: 0xffffff })
    // 尾巴那条横杆，左端插进三角里一点，两块才连成一支箭。
    .rect(headX * 0.55, barTop, width - headX * 0.55, height * 0.22)
    .fill({ color: 0xffffff })
  return mold(width, height, g)
}
