/**
 * 没有底板的文字钮：需求单的按钮 I（首页导航文字项）和按钮 H（图标加文字钮，也就是返回）。
 *
 * 两者是**同一颗按钮**的两个变体，不是两个组件：都只有一行字、都靠提亮做悬停反馈、
 * 都不画底也不画框。差别只有两处——H 在字左边多一支箭头，悬停时箭头往左挪一点；
 * I 没有箭头，悬停时整行提亮。
 *
 * 悬停只写 `tint` 和 `x`（3.10），不换纹理也不重量文字。禁用态不做：
 * 需求单里这两个变体的状态行都写着「禁用 —」——它们是导航，不该出现点不动的导航项。
 *
 * 命中区显式给成整块矩形：一行字的包围盒只有字那么高，指针要精确压到笔画之间才算命中，
 * 在手机上基本点不着（同 PlaqueButton 的理由）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Rectangle, Sprite } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量。 */
export type TextButtonVariant = 'H' | 'I'

/** 图标加文字钮：左上角那类「箭头 + 文字」的返回。 */
export const TEXT_BUTTON_BACK: TextButtonVariant = 'H'
/** 首页底部那排纯文字菜单项。 */
export const TEXT_BUTTON_NAV: TextButtonVariant = 'I'

export interface TextButtonDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export interface TextButtonOptions {
  variant: TextButtonVariant
  caption: string
  /** 字号（px）。两页的字号差得远（首页 28.8、英雄页 16.6），所以由调用方给。 */
  fontSize: number
  /** 常态字色。不给就是夜色页面那一档米色。 */
  color?: string
  /** 悬停时提亮到的颜色。不给就是米色被点亮的那一档。 */
  litColor?: string
  /** 上下各留多少留白，决定命中区有多高。 */
  padY?: number
  onActivate?: () => void
}

/** 字距按字号取比例：需求单里首页导航是 0.24em、返回按钮是 0.1em 上下，取中间那一档。 */
const LETTER_SPACING_EM = 0.18
/** 箭头的高按字号取比例，宽再按模具的长宽比换算。 */
const ARROW_HEIGHT_EM = 0.72
/** 箭头和字之间的空当。 */
const ARROW_GAP_EM = 0.42
/** 悬停时箭头往左挪多少（按字号取比例）。 */
const ARROW_SHIFT_EM = 0.22

export class TextButton extends Container {
  readonly boxWidth: number
  readonly boxHeight: number

  private readonly caption: Label
  private readonly arrow: Sprite | null = null
  private readonly deps: TextButtonDeps
  private readonly color: string
  private readonly litColor: string
  private readonly arrowShift: number
  private hovering = false

  constructor(options: TextButtonOptions, deps: TextButtonDeps) {
    super()
    this.deps = deps
    this.color = options.color ?? tokens.color.home.ink
    this.litColor = options.litColor ?? tokens.color.home.inkLit
    this.arrowShift = options.fontSize * ARROW_SHIFT_EM

    this.caption = new Label(
      options.caption,
      {
        fontSize: options.fontSize,
        weight: '600',
        letterSpacing: options.fontSize * LETTER_SPACING_EM,
        align: 'left',
      },
      deps,
      this.color,
    )

    const padY = options.padY ?? options.fontSize * 0.6
    let x = 0
    if (options.variant === 'H') {
      const height = options.fontSize * ARROW_HEIGHT_EM
      const arrow = new Sprite(deps.ui.backArrow)
      arrow.anchor.set(0, 0.5)
      arrow.height = height
      arrow.width = (height * deps.ui.backArrow.width) / deps.ui.backArrow.height
      arrow.tint = this.color
      this.arrow = arrow
      this.addChild(arrow)
      x = arrow.width + options.fontSize * ARROW_GAP_EM
    }

    this.boxWidth = x + this.caption.textWidth
    this.boxHeight = this.caption.textHeight + padY * 2
    if (this.arrow !== null) this.arrow.position.set(0, this.boxHeight / 2)
    this.caption.position.set(x, this.boxHeight / 2)
    this.addChild(this.caption)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(0, 0, this.boxWidth, this.boxHeight)
    this.on('pointerover', () => this.setHover(true))
    this.on('pointerout', () => this.setHover(false))
    this.on('pointertap', () => options.onActivate?.())
  }

  /** 把悬停态直接摆出来（目录页要拍这一张，没有真指针可用）。 */
  showHover(hover: boolean): void {
    this.setHover(hover)
  }

  private setHover(hover: boolean): void {
    if (hover === this.hovering) return
    this.hovering = hover
    const color = hover ? this.litColor : this.color
    this.caption.setColor(color)
    if (this.arrow === null) return
    this.arrow.tint = color
    this.deps.animator.tween(this.arrow, {
      x: hover ? -this.arrowShift : 0,
      duration: tokens.duration.button.hover,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }
}
