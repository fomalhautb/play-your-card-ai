/**
 * 分隔线：需求单的边框 E（中线横杆）和边框 F（分隔线加宝石）。
 *
 * 两个变体是同一件事的两档——一条两端淡出的细线，中间让出一块地方。
 * E 让出来的是一个空档（战场中线正中要嵌一枚回合徽章，徽章本身是 Badge E，不在这里）；
 * F 让出来的位置上压一颗菱形宝石。所以合成一个组件、两个编号变体。
 *
 * 两端的淡出用一张烤好的渐变带（fx/frameShapes.ts 的 drawRamp）左右各贴一张：
 * Graphics 的渐变填充在不同后端上插值不完全一致（4.4 要求各浏览器一样），
 * 而一张纹理拉伸出来的结果是确定的。翻转靠 scale 的负号，不用第二张图。
 *
 * 竖版（结算层题目区和答案区之间那条）是把整条转 90°，不是另写一套几何。
 * 转的是 Container 的 rotation，属于 transform，不重建任何东西。
 *
 * 原点在线的**起点**、纵向在线的中心：横版就是左端中点，竖版转过来就是上端中点。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite, Texture } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'

/** 编号变体。语义名见下面的别名常量。 */
export type DividerVariant = 'E' | 'F'

export const DIVIDER_MIDLINE: DividerVariant = 'E'
export const DIVIDER_GEM: DividerVariant = 'F'

/** 中线横杆的线粗。旧样式从 1px 加到 2px 是为了扛住手绘滤镜，这里沿用同样的分量。 */
const MIDLINE_THICKNESS = tokens.size.midline.railThickness
/** 分隔线的线粗。 */
const GEM_LINE_THICKNESS = 1

export interface DividerDeps {
  ui: UiTextures
}

export interface DividerOptions {
  variant: DividerVariant
  /** 整条有多长。 */
  length: number
  /**
   * 中间让出多宽。
   * E 用来给回合徽章腾地方，F 不用给——宝石自己有多宽这里就让多宽。
   */
  gap?: number
  /** 竖着摆（结算层那条）。整条转 90°，几何不变。 */
  vertical?: boolean
}

export class Divider extends Container {
  readonly variant: DividerVariant

  constructor(options: DividerOptions, deps: DividerDeps) {
    super()
    this.variant = options.variant
    this.eventMode = 'none'

    const gem = options.variant === 'F'
    const gemSize = tokens.size.frame.gem
    const gap = options.gap ?? (gem ? gemSize * Math.SQRT2 : 0)
    const thickness = gem ? GEM_LINE_THICKNESS : MIDLINE_THICKNESS
    const color = gem ? tokens.color.battle.lineDark : tokens.color.midline.rail
    const alpha = gem ? 1 : tokens.opacity.midline.rail
    const segment = Math.max(0, (options.length - gap) / 2)

    // 左半段：从最淡（外端）渐显到最实（内端）。右半段横向翻转，翻转轴在它自己的右端。
    this.addRamp(deps.ui.ramp, 0, segment, thickness, color, alpha, 1)
    this.addRamp(deps.ui.ramp, options.length, segment, thickness, color, alpha, -1)
    if (gem) this.addGem(gemSize, options.length / 2)
    if (options.vertical === true) this.rotation = Math.PI / 2
  }

  private addRamp(
    texture: Texture,
    x: number,
    length: number,
    thickness: number,
    color: string,
    alpha: number,
    sx: 1 | -1,
  ): void {
    const sprite = new Sprite(texture)
    sprite.anchor.set(0, 0.5)
    sprite.setSize(length, thickness)
    sprite.scale.x *= sx
    sprite.x = x
    sprite.tint = color
    sprite.alpha = alpha
    this.addChild(sprite)
  }

  /**
   * 正中那颗菱形：一个方块转 45°，外面一圈描边色、里面一块纸色。
   *
   * 里面那块不透明是有用的——旧版靠它把细线从中间截断，两头淡出加中间这一颗，
   * 看着才像一件装饰而不是一条被打断的线。
   */
  private addGem(size: number, centerX: number): void {
    const outer = new Sprite(Texture.WHITE)
    outer.anchor.set(0.5)
    outer.setSize(size, size)
    outer.rotation = Math.PI / 4
    outer.tint = tokens.color.battle.lineDark
    const inner = new Sprite(Texture.WHITE)
    inner.anchor.set(0.5)
    inner.setSize(size - 2, size - 2)
    inner.rotation = Math.PI / 4
    inner.tint = tokens.color.battle.paper
    for (const sprite of [outer, inner]) {
      sprite.x = centerX
      this.addChild(sprite)
    }
  }
}
