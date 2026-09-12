/**
 * 气泡和一行提示：需求单的提示 B（浮起小气泡）、C（喊话气泡）、E（错误红字）。
 *
 * 三个变体是「贴着某个东西冒出来的一句话」的三档：
 *   B 手牌锁住时贴着那张牌顶上弹出来的原因，夜色药丸底，压在深色战场上；
 *   C 「催一催」喊出去之后的字幕，纸色底，右下角带一条指向按钮的小尾巴；
 *   E 指令被引擎拒了的那一行红字，**没有底**——它压在战场上，加个底反而像个弹窗。
 *
 * 三个都不吃指针事件：它们盖在手牌和按钮上面，吃了的话下面就点不着了（旧版三处都写了
 * `pointer-events: none`）。
 *
 * 淡入淡出走 `show()` / `hide()`，补间从 Animator 建——只有它建的补间会被帧循环记账，
 * 手动时钟才推得动、也才停得下来（3.6）。只改 alpha 和 y，符合 3.10。
 * 往上浮的那一小段改的是**内层**的 y：气泡自己的 position 是调用方摆版式用的，
 * 两边写同一个属性的话，一淡入就会把调用方摆的位置冲掉。
 * 建出来默认是**藏着的**（alpha 0）：旧版这三处的初值也都是 `opacity: 0`，
 * 满足条件才淡入。
 *
 * 底走 Graphics 而不是预烤纹理，理由同 Panel：一屏最多一两个，而宽度跟着文案走，
 * 烤纹理要为每种宽度各烤一张。几何只在建的时候画一次。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量。 */
export type BubbleVariant = 'B' | 'C' | 'E'

export const BUBBLE_TIP: BubbleVariant = 'B'
export const BUBBLE_SHOUT: BubbleVariant = 'C'
export const BUBBLE_ERROR: BubbleVariant = 'E'

/** 浮起小气泡：字号和内边距抄旧样式的 `.hand-fan__lock-tip`（`--fs-md`、4px 12px）。 */
const TIP = { fontSize: tokens.font.size.md, padX: 12, padY: 4 }
/** 喊话气泡：17px 中号字，内边距 10px 14px 11px（取上下的均值 10.5）。 */
const SHOUT = { fontSize: 17, padX: 14, padY: 10.5 }
/** 错误红字：`--fs-base` 那一档，没有底也就没有内边距。 */
const ERROR = { fontSize: tokens.font.size.base, padX: 0, padY: 0 }
/** 喊话气泡尾巴的宽和高，抄旧样式那两层三角（外层 9×10、内层 8×9）。 */
const TAIL = { halfWidth: 9, height: 10 }
/** 尾巴离气泡右缘多远。旧样式 `right: 22px`，指的是三角中心那一带。 */
const TAIL_INSET = 22
/** 淡入时从下方浮上来的距离。旧样式 `translateY(6px)` 起手。 */
const RISE = 6

export interface BubbleDeps {
  text: TextTextureCache
  /** 补间的唯一入口。淡入淡出都从这儿建（3.6）。 */
  animator: Animator
}

export interface BubbleOptions {
  variant: BubbleVariant
  content: string
  /** 一行最多多宽，超了整体缩小。不给就跟着文案自然长。 */
  maxWidth?: number
}

export class Bubble extends Container {
  readonly variant: BubbleVariant
  readonly boxWidth: number
  readonly boxHeight: number

  private readonly deps: BubbleDeps
  /** 淡入时往上浮的那一层。气泡自己的 position 留给调用方，两边互不覆盖。 */
  private readonly inner = new Container()

  constructor(options: BubbleOptions, deps: BubbleDeps) {
    super()
    this.variant = options.variant
    this.deps = deps
    this.eventMode = 'none'
    // 默认藏着。三处旧样式的初值都是 opacity: 0，满足条件才淡入。
    this.alpha = 0

    const metrics = options.variant === 'B' ? TIP : options.variant === 'C' ? SHOUT : ERROR
    const ink =
      options.variant === 'B'
        ? tokens.color.bubble.tipInk
        : options.variant === 'C'
          ? tokens.color.battle.ink
          : tokens.color.status.errorLit
    const label = new Label(
      options.content,
      { fontSize: metrics.fontSize, maxWidth: options.maxWidth },
      deps,
      ink,
    )
    this.boxWidth = Math.round(label.width) + metrics.padX * 2
    this.boxHeight = Math.round(label.height) + metrics.padY * 2

    this.addChild(this.inner)
    if (options.variant !== 'E') this.inner.addChild(this.drawPlate(options.variant))
    label.position.set(this.boxWidth / 2, this.boxHeight / 2)
    this.inner.addChild(label)
  }

  /** 淡入。上一次的补间会被顶掉（overwrite），连点同一张牌不会两段动画打架。 */
  show(): void {
    this.deps.animator.fromTo(
      this.inner,
      { y: RISE },
      { y: 0, duration: tokens.duration.bubble.in, ease: 'power2.out', overwrite: true },
    )
    this.deps.animator.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration: tokens.duration.bubble.in, ease: 'power2.out', overwrite: true },
    )
  }

  /**
   * 当场收掉：掐掉自己身上的补间。
   *
   * 销毁之前必须调它。淡入那一下补的是**私有的**内层容器，外面掐不到——
   * 而没掐干净就销毁，下一帧 GSAP 会在拆掉的对象上取属性、当场抛错。
   */
  clear(): void {
    this.deps.animator.killTweensOf(this.inner)
    this.deps.animator.killTweensOf(this)
  }

  /** 淡出。位置不动——往回沉一下反而像是被谁推走的。 */
  hide(): void {
    this.deps.animator.tween(this, {
      alpha: 0,
      duration: tokens.duration.bubble.out,
      overwrite: true,
    })
  }

  private drawPlate(variant: 'B' | 'C'): Graphics {
    const g = new Graphics()
    if (variant === 'B') {
      // 药丸型：圆角取半个高就是两端的半圆。
      g.roundRect(0, 0, this.boxWidth, this.boxHeight, this.boxHeight / 2)
        .fill({ color: tokens.color.bubble.tipBase, alpha: tokens.opacity.bubble.tipBase })
        .stroke({
          width: 1,
          color: tokens.color.bubble.tipLine,
          alpha: tokens.opacity.bubble.tipLine,
        })
      return g
    }
    /*
     * 喊话气泡：圆角矩形加一条指向右下的小尾巴。
     * 尾巴是两层三角——外层深一档当描边，内层填纸色把描边从中间截断，
     * 于是尾巴和气泡看着是连着的一整块，而不是贴了个三角在下面。
     */
    const tailX = this.boxWidth - TAIL_INSET
    g.roundRect(0, 0, this.boxWidth, this.boxHeight, tokens.radius.xxl)
      .fill({ color: tokens.color.battle.paper })
      .stroke({ width: 1, color: tokens.color.battle.lineDark })
    g.moveTo(tailX - TAIL.halfWidth, this.boxHeight)
      .lineTo(tailX + TAIL.halfWidth, this.boxHeight)
      .lineTo(tailX, this.boxHeight + TAIL.height)
      .closePath()
      .fill({ color: tokens.color.battle.lineDark })
    g.moveTo(tailX - TAIL.halfWidth + 1, this.boxHeight - 1)
      .lineTo(tailX + TAIL.halfWidth - 1, this.boxHeight - 1)
      .lineTo(tailX, this.boxHeight + TAIL.height - 2)
      .closePath()
      .fill({ color: tokens.color.battle.paper })
    return g
  }
}
