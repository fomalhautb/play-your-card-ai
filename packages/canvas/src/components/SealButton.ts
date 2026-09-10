/**
 * 夜色圆章图标钮（需求单按钮 J）：一枚半透明的深色圆底、一圈细外框，中间一枚米色剪影。
 *
 * 深色页面上的图标开关都是它——首页和选英雄页的静音钮，将来还有组牌页的加减钮。
 * 和纸面上那颗无底图标钮（按钮 K，见 PlaqueButton 的变体 K）是**两个变体不是两个组件**的反例：
 * 那颗真的不画底，这颗画两层底，共用一份代码只会变成一串 if。
 *
 * 圆底和外圈用预烤的 `sealDisc` / `sealRing`（全白），靠 tint 和 alpha 上色；
 * 图标纹理由调用方给（canvas 不管资源从哪来）。悬停只写 alpha 和 scale（3.10）。
 */

import { tokens } from '@ai-duel/design'
import type { Platform, SoundSpec } from '@ai-duel/platform'
import { Circle, Container, Sprite, type Texture } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'

export interface SealButtonDeps {
  ui: UiTextures
  animator: Animator
  platform: Pick<Platform, 'audio' | 'haptics'>
  /** 按下时放的那一声；给 null 就不出声（同 PlaqueButton）。 */
  clickSound: SoundSpec | null
}

export interface SealButtonOptions {
  /** 圆章直径。首页那颗 52、别的页 34，见 `size.seal.home` / `size.seal.page`。 */
  size: number
  /** 中间那枚剪影。 */
  icon: Texture
  /** 剪影占直径的几成。默认 0.5——太满会顶到外圈上。 */
  iconRatio?: number
  disabled?: boolean
  onActivate?: () => void
}

/** 悬停时整枚放大到多少。 */
const HOVER_SCALE = 1.08
/** 按下时缩回去，比常态还小一点。 */
const PRESS_SCALE = 0.94
/** 禁用时压暗到这一档（需求单里组牌页加钮到顶时就是这个值）。 */
const DISABLED_ALPHA = 0.34

export class SealButton extends Container {
  readonly boxWidth: number
  readonly boxHeight: number

  /** 会被缩放的那一层。按钮自己的 position 留给调用方摆版式。 */
  private readonly inner = new Container()
  private readonly icon: Sprite
  private readonly deps: SealButtonDeps
  private readonly onActivate: (() => void) | undefined
  private disabled: boolean

  constructor(options: SealButtonOptions, deps: SealButtonDeps) {
    super()
    this.deps = deps
    this.onActivate = options.onActivate
    this.disabled = options.disabled === true
    this.boxWidth = options.size
    this.boxHeight = options.size
    this.label = 'seal-button'

    const half = options.size / 2
    // 以圆心为支点缩放。
    this.inner.position.set(half, half)
    this.addChild(this.inner)

    this.inner.addChild(
      disc(deps.ui.sealDisc, options.size, tokens.color.seal.base, tokens.opacity.seal.base),
      disc(deps.ui.sealRing, options.size, tokens.color.seal.mark, 1),
    )

    const iconSize = options.size * (options.iconRatio ?? 0.5)
    this.icon = new Sprite(options.icon)
    this.icon.anchor.set(0.5)
    this.icon.width = iconSize
    this.icon.height = (iconSize * options.icon.height) / options.icon.width
    this.icon.tint = tokens.color.seal.mark
    this.inner.addChild(this.icon)

    this.eventMode = 'static'
    this.cursor = this.disabled ? 'default' : 'pointer'
    // 命中区就是那枚圆，不是它的外接方框：四个角落在圆外面，点那儿高亮却没反应最恼人。
    this.hitArea = new Circle(half, half, half)
    this.alpha = this.disabled ? DISABLED_ALPHA : 1
    this.bindPointer()
  }

  /** 换一枚剪影（静音钮在「有声」和「静音」之间切）。只换纹理，不重建对象。 */
  setIcon(icon: Texture): void {
    const width = this.icon.width
    this.icon.texture = icon
    this.icon.width = width
    this.icon.height = (width * icon.height) / icon.width
  }

  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return
    this.disabled = disabled
    this.cursor = disabled ? 'default' : 'pointer'
    this.alpha = disabled ? DISABLED_ALPHA : 1
  }

  /** 把悬停态直接摆出来（目录页要拍这一张，没有真指针可用）。 */
  showHover(hover: boolean): void {
    this.inner.scale.set(hover ? HOVER_SCALE : 1)
  }

  private bindPointer(): void {
    this.on('pointerover', () => {
      if (!this.disabled) this.applyScale(HOVER_SCALE)
    })
    this.on('pointerout', () => this.applyScale(1))
    this.on('pointerdown', () => {
      if (this.disabled) return
      this.deps.platform.haptics.selection()
      if (this.deps.clickSound !== null) this.deps.platform.audio.play(this.deps.clickSound)
      this.applyScale(PRESS_SCALE)
    })
    this.on('pointerup', () => {
      if (this.disabled) return
      this.applyScale(HOVER_SCALE)
      this.onActivate?.()
    })
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

/** 圆章的一层：整枚铺满、以圆心为原点。 */
function disc(texture: Texture, size: number, color: string, alpha: number): Sprite {
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  sprite.width = size
  sprite.height = size
  sprite.tint = color
  sprite.alpha = alpha
  return sprite
}
