/**
 * 图片底板按钮：需求单的按钮 E（首页开始匾额）和按钮 F（匹配房那几颗切片按钮）。
 *
 * 两者是**同一颗按钮**换一张底图：一张画好的底板加一行居中文字，界面代码只挑变体、给纹理。
 * 唯一的行为差别是 E 常驻一条上下浮动（`duration.home.startFloat`）——
 * 首页整页是静止的一幅画，主入口自己轻轻动着才看得出「这里能点」。
 *
 * 底图不归 canvas 管（架构第 2 节第 5 条），纹理由调用方给。
 * 悬停只写 `scale` 和 `tint`，按下只写 `scale`，都不重建对象（3.10）；不挂 Filter（3.1），
 * 旧样式那句 `filter: brightness(1.08)` 换成往白里提一档 tint，观感一样、代价差一次离屏渲染。
 */

import { tokens } from '@ai-duel/design'
import type { Platform, SoundSpec } from '@ai-duel/platform'
import { Container, Rectangle, Sprite, type Texture } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量。 */
export type PlateVariant = 'E' | 'F'

/** 首页那颗「开始游戏」，自带常驻浮动。 */
export const PLATE_HOME_START: PlateVariant = 'E'
/** 匹配房那几颗（加入房间、卡组 / 英雄横幅）。 */
export const PLATE_PANEL: PlateVariant = 'F'

export interface PlateButtonDeps {
  text: TextTextureCache
  animator: Animator
  platform: Pick<Platform, 'audio' | 'haptics'>
  /** 按下时放的那一声。资源地址不归 canvas 管；给 null 就不出声（同 PlaqueButton）。 */
  clickSound: SoundSpec | null
}

export interface PlateButtonOptions {
  variant: PlateVariant
  /** 底板那张图。 */
  plate: Texture
  caption: string
  /** 整颗按钮多宽。高按底图的长宽比算出来，免得把画好的匾额拉变形。 */
  width: number
  fontSize: number
  /** 字色。不给就是需求单里那一档深墨。 */
  color?: string
  /**
   * 文字往右让开多少（px）。匹配房那两块横幅的左侧画着插图，字要避开它。
   * 不给就整块居中。
   */
  textInsetLeft?: number
  disabled?: boolean
  onActivate?: () => void
}

/** 悬停放大到多少、提亮到什么颜色。旧样式是 scale(1.03) + brightness(1.08)。 */
const HOVER_SCALE = 1.03
const HOVER_TINT = '#fff6e6'
/** 按下时缩回去一点，比悬停还小一档，才像被按进去了。 */
const PRESS_SCALE = 0.985
/** 常驻浮动往上浮多少（按按钮自己的高取比例，缩放到任何尺寸都一样）。 */
const FLOAT_RISE_RATIO = 0.055
/** 禁用时整颗压暗到这一档。 */
const DISABLED_ALPHA = 0.5

export class PlateButton extends Container {
  readonly boxWidth: number
  readonly boxHeight: number

  /** 会被悬停和按下缩放的那一层。按钮自己的 position 留给调用方摆版式。 */
  private readonly inner = new Container()
  private readonly plate: Sprite
  private readonly caption: Label
  private readonly deps: PlateButtonDeps
  private readonly onActivate: (() => void) | undefined
  private disabled: boolean
  private hovering = false

  constructor(options: PlateButtonOptions, deps: PlateButtonDeps) {
    super()
    this.deps = deps
    this.onActivate = options.onActivate
    this.disabled = options.disabled === true

    const ratio = options.plate.height / options.plate.width
    this.boxWidth = options.width
    this.boxHeight = options.width * ratio
    this.label = 'plate-button'

    // 以整块中心为支点缩放：pivot 摆到中心，再把整层挪回原位。
    this.inner.pivot.set(this.boxWidth / 2, this.boxHeight / 2)
    this.inner.position.set(this.boxWidth / 2, this.boxHeight / 2)
    this.addChild(this.inner)

    this.plate = new Sprite(options.plate)
    this.plate.width = this.boxWidth
    this.plate.height = this.boxHeight
    this.inner.addChild(this.plate)

    const inset = options.textInsetLeft ?? 0
    this.caption = new Label(
      options.caption,
      {
        fontSize: options.fontSize,
        weight: '600',
        letterSpacing: options.fontSize * 0.28,
        maxWidth: this.boxWidth - inset - options.fontSize,
      },
      deps,
      options.color ?? tokens.color.paper.ink,
    )
    this.caption.position.set(inset + (this.boxWidth - inset) / 2, this.boxHeight / 2)
    this.inner.addChild(this.caption)

    this.eventMode = 'static'
    this.cursor = this.disabled ? 'default' : 'pointer'
    this.hitArea = new Rectangle(0, 0, this.boxWidth, this.boxHeight)
    this.alpha = this.disabled ? DISABLED_ALPHA : 1
    this.bindPointer()
    if (options.variant === 'E') this.startFloat()
  }

  /** 点不点得动。 */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return
    this.disabled = disabled
    this.cursor = disabled ? 'default' : 'pointer'
    this.alpha = disabled ? DISABLED_ALPHA : 1
    if (disabled) this.applyScale(1)
  }

  /** 把悬停态直接摆出来（目录页要拍这一张，没有真指针可用）。 */
  showHover(hover: boolean): void {
    this.hovering = hover
    this.plate.tint = hover ? HOVER_TINT : 0xffffff
    this.inner.scale.set(hover ? HOVER_SCALE : 1)
  }

  /**
   * 常驻浮动（只有变体 E 有）。
   *
   * 挂在**内层**的 y 上而不是按钮自己的：按钮自己的 position 归调用方摆版式，
   * 补间写上去会和版式打架（而且建好之后调用方才摆位置，起点就错了）。
   * 内层的缩放走的是 `inner.scale` 这个独立对象，和这条补间不抢同一个属性。
   * 浮动是 `repeat: -1` 的，所以首页的帧循环**不会停**——
   * 首页本来就一直有东西在动，这是预期而不是 3.6 的漏网。
   */
  private startFloat(): void {
    const rise = this.boxHeight * FLOAT_RISE_RATIO
    this.deps.animator.tween(this.inner, {
      y: this.inner.y - rise,
      duration: tokens.duration.home.startFloat / 2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
  }

  private bindPointer(): void {
    this.on('pointerover', () => {
      if (this.disabled) return
      this.hovering = true
      this.plate.tint = HOVER_TINT
      this.applyScale(HOVER_SCALE)
    })
    this.on('pointerout', () => {
      this.hovering = false
      this.plate.tint = 0xffffff
      if (!this.disabled) this.applyScale(1)
    })
    this.on('pointerdown', () => {
      if (this.disabled) return
      this.deps.platform.haptics.selection()
      if (this.deps.clickSound !== null) this.deps.platform.audio.play(this.deps.clickSound)
      this.applyScale(PRESS_SCALE)
    })
    this.on('pointerup', () => {
      if (this.disabled) return
      this.applyScale(this.hovering ? HOVER_SCALE : 1)
      this.onActivate?.()
    })
    // 指针在按钮外面松手：只把姿态收回去，不算点中。
    this.on('pointerupoutside', () => this.applyScale(1))
  }

  private applyScale(scale: number): void {
    this.deps.animator.tween(this.inner.scale, {
      x: scale,
      y: scale,
      duration: tokens.duration.button.hover,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }
}
