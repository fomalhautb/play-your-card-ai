/**
 * 对局那批复合组件要的模具：Token 四芒星、硬币的盘面和外圈。
 *
 * 规矩同 plaqueShapes / frameShapes：一律画成白色，用的时候靠 tint 和 alpha 上色。
 * 四芒星一屏最多十来颗、只在 tint 上分「还剩 / 已花 / 白捡的」三档，
 * 正是预烤纹理最划算的场合——十几颗共用一张纹理，还能合进同一批（3.9）。
 *
 * 硬币的两面在旧版是两张切图（`/battle/coin-first.webp` / `coin-second.webp`）。
 * 这里改成画出来，理由和「下一题」纸匾一样：素材还没搬（第 33 条），而画出来的盘面
 * 只是一枚圆牌加两圈线，正反面的区别靠盘上那两个字（先手 / 后手）说清楚。
 * 素材到位之后把盘面这两张换成图集里的贴图即可，翻转那段时间线一个字都不用改。
 */

import { Graphics, GraphicsPath } from 'pixi.js'
import { type Mold, mold } from './mold'

/**
 * 四芒星的设计尺寸，也是旧版那段 SVG 的 viewBox。
 * 路径和站点图标（黑客松版的 public/favicon.svg）是同一份。
 */
const STAR_BASE = 100

/**
 * Token 那颗四芒星。
 *
 * 四个尖端留了 1 个单位宽的平口而不是收成一个点：这颗星在细条里只有 30px 见方，
 * 真收成尖点的话边缘会被抗锯齿抹掉半截，一列星星看着长短不齐。
 */
const STAR_PATH =
  'M49.5 4L50.5 4L57 43L96 49.5L96 50.5L57 57L50.5 96L49.5 96L43 57L4 50.5L4 49.5L43 43Z'

/** 一颗 Token 星。烤成 100×100，用的时候缩到细条里那一档。 */
export function drawTokenStar(): Mold {
  const g = new Graphics().path(new GraphicsPath(STAR_PATH)).fill({ color: 0xffffff })
  return mold(STAR_BASE, STAR_BASE, g)
}

/**
 * 硬币盘面的模具尺寸。
 *
 * 真正画出来是 240（旧样式 `.coin-toss__coin` 的宽高），这里只烤 128：
 * 盘面是一块纯色圆加两圈同心线，放大两倍不会露出锯齿，而 240 见方的纹理要多占三倍多显存。
 * 外圈线宽按半径取比例，缩放之后粗细看着还是一样的。
 */
const COIN_BASE = 128

/** 硬币的盘面：一枚实心圆。 */
export function drawCoinFace(): Mold {
  const r = COIN_BASE / 2
  return mold(COIN_BASE, COIN_BASE, new Graphics().circle(r, r, r).fill({ color: 0xffffff }))
}

/**
 * 硬币的两圈边：外面一圈粗的当币缘，里面一圈细的把盘面框出来。
 *
 * 两圈都画在同一张纹理里而不是拆成两层：它们同色（币缘和内圈线在旧版那张切图上也是一样的），
 * 浓淡差别直接把 alpha 画进纹理，按 frameShapes 文件头那条规矩不必多占一张。
 */
export function drawCoinRim(): Mold {
  const r = COIN_BASE / 2
  const outer = COIN_BASE * 0.055
  const g = new Graphics()
  g.circle(r, r, r - outer / 2).stroke({ width: outer, color: 0xffffff })
  g.circle(r, r, r * 0.78).stroke({ width: COIN_BASE * 0.016, color: 0xffffff, alpha: 0.7 })
  return mold(COIN_BASE, COIN_BASE, g)
}
