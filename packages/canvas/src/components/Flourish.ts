/**
 * 星芒细线花饰（需求单边框 C）：一条两端淡出的细横线，正中嵌一颗四角星。
 *
 * 夜色页面（首页、选英雄页、匹配房）的标题两侧、人物介绍卡的分隔线都是它。
 * 只有一个编号变体，但有两种摆法：`sides: 'both'` 是「线—星—线」（分隔线），
 * `sides: 'right'` / `'left'` 是「线—星」（标题两侧各挂一支，星朝内）。
 *
 * 线用预烤的渐变带（`ui.ramp`）横向拉伸，不是画一条 1px 的实线：
 * 需求单边框 C 那条写明这根线是**往外侧淡到 0** 的，直接画实线两端会有硬切口。
 * 拉伸只写 `scale`，不重画任何图形（3.10）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'

/** 花饰摆法：星在中间、星在右端、星在左端。 */
export type FlourishSides = 'both' | 'right' | 'left'

export interface FlourishDeps {
  ui: UiTextures
}

export interface FlourishOptions {
  /** 整支花饰的宽（含星）。 */
  width: number
  /** 星的边长。线的粗细按它取比例，两者才配得上。 */
  starSize: number
  sides?: FlourishSides
  /** 线和星的颜色。不给就用首页那一档米色。 */
  color?: string
}

/** 线的粗细按星的边长取比例：星大线也该粗一点，写死像素在两页之间就对不上。 */
const LINE_RATIO = 0.09
/** 星和线之间留的空当，同样按星的边长取。 */
const GAP_RATIO = 0.28

/**
 * 一支花饰。原点在**左端中点**，整支往右铺开——标题两侧各挂一支时，
 * 调用方只要算左右两个端点，不用再管星在哪一头。
 */
export class Flourish extends Container {
  readonly boxWidth: number
  readonly boxHeight: number

  constructor(options: FlourishOptions, deps: FlourishDeps) {
    super()
    const { width, starSize } = options
    const sides = options.sides ?? 'both'
    const color = options.color ?? tokens.color.home.flourish
    this.boxWidth = width
    this.boxHeight = starSize
    this.label = 'flourish'

    const gap = starSize * GAP_RATIO
    const thickness = Math.max(1, starSize * LINE_RATIO)
    // 星在中间时两边各分一半线；星在一端时那一整段都是线。
    const lineTotal = Math.max(0, width - starSize - gap * (sides === 'both' ? 2 : 1))
    const lineWidth = sides === 'both' ? lineTotal / 2 : lineTotal

    const starX =
      sides === 'left' ? starSize / 2 : sides === 'right' ? width - starSize / 2 : width / 2
    if (sides !== 'left') this.addLine(deps, 0, lineWidth, thickness, color, false)
    if (sides !== 'right') this.addLine(deps, width - lineWidth, lineWidth, thickness, color, true)
    this.addStar(deps, starX, starSize, color)
  }

  /**
   * 一段渐变线。`fadeLeft` 决定往哪一头淡出——渐变带本身是从透明走到实的，
   * 靠负的 scale.x 左右翻转，不用另烤一张反向的。
   */
  private addLine(
    deps: FlourishDeps,
    x: number,
    width: number,
    thickness: number,
    color: string,
    fadeLeft: boolean,
  ): void {
    if (width <= 0) return
    const line = new Sprite(deps.ui.ramp)
    line.anchor.set(0, 0.5)
    line.width = width
    line.height = thickness
    line.tint = color
    line.alpha = tokens.opacity.home.flourishLine
    // 翻转之后精灵是从右往左长的，起点因此要挪到这一段的右端。
    if (fadeLeft) {
      line.scale.x = -line.scale.x
      line.position.set(x + width, this.boxHeight / 2)
    } else {
      line.position.set(x, this.boxHeight / 2)
    }
    this.addChild(line)
  }

  private addStar(deps: FlourishDeps, x: number, size: number, color: string): void {
    const star = new Sprite(deps.ui.sparkle)
    star.anchor.set(0.5)
    star.width = size
    star.height = size
    star.tint = color
    star.alpha = tokens.opacity.home.flourishStar
    star.position.set(x, this.boxHeight / 2)
    this.addChild(star)
  }
}
