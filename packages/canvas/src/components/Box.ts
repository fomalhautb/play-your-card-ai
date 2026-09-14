/**
 * 画布上的素方块：一圈描边矩形，里面可以印一行字。
 *
 * 正式版简化第 4 步立的**唯一**通用原语。视觉后面整套重做，在那之前按钮、面板、
 * 一行状态字这些「版式不重要、能用就行」的地方一律用它，不再各造一个带底图和配色的组件。
 *
 * 只有一种长相：1px 描边、单色、无填充、无圆角、无阴影、无纹理、没有悬停和按下的视觉态。
 * 不给它加第二套主题或者变体系统——需要「标题 + 内容」的面板就是两个 Box 摆在一起。
 * 禁用只用透明度表达，不换颜色：换色就等于又开始定配色了。
 *
 * 字走 `TextTextureCache` 烤成纹理（3.5「文字只创建一次并缓存」），
 * 而且**不指定字体**，用 Pixi 的默认字体：这一版不做字体选型，
 * 指定一个就等于替后面的视觉重做提前拍了板。也因此目录页基线图上的字形跟着机器走，
 * 基线仍然按平台分目录。
 */

import { Container, Graphics, Rectangle, Sprite, TextStyle } from 'pixi.js'
import type { TextTextureCache } from '../runtime/textCache'

/**
 * 整块画布的底色。
 *
 * 三个素方块场景（首页、房间页、开包页）建渲染器时用它，同时各自在场景根上垫一块同色的底：
 * 挂在别人渲染器上的那一档（组件目录页）改不了渲染器的底色，
 * 不垫的话深色描边会压在目录页的深底上看不见。
 */
export const CANVAS_BACKGROUND = 0xeeeeee

/** 描边色。 */
export const BOX_LINE = 0x222222

/** 字色。 */
export const BOX_INK = 0x000000

/** 禁用时整块的透明度。只有这一档，不换颜色。 */
export const BOX_DISABLED_ALPHA = 0.4

/** 字号按角色分三档，没有第四档。 */
export type BoxSize = 'title' | 'body' | 'small'

export const BOX_FONT_SIZE: Record<BoxSize, number> = { title: 24, body: 16, small: 12 }

/** 靠左对齐时字离左边框多远；居中时字最多占到离两边各这么远。 */
const PAD_X = 8

export interface BoxDeps {
  text: TextTextureCache
}

export interface BoxOptions {
  width: number
  height: number
  /** 印在方块里的那一行字。不给就是一个空方块。 */
  label?: string
  /** 字号档，默认 body。 */
  size?: BoxSize
  /** 横向对齐，默认居中。 */
  align?: 'center' | 'left'
  /**
   * 吃不吃指针事件。
   *
   * 按钮不用自己传：`onPress` 会顺手打开。这一项是给「只想挡住底下的东西」
   * 那种情况用的（房间页面板背后那一圈空地就是靠它把点击留在这一页里）。
   */
  interactive?: boolean
}

/**
 * 三档字号各自的样式，全局缓存一份。
 *
 * 不设 `fontFamily`（理由见文件头），颜色直接烤成黑的——这个组件的字一辈子只有一种颜色，
 * 不需要像 `Label` 那样烤成白的再靠 tint 换色。
 */
const styleCache = new Map<BoxSize, TextStyle>()

function styleOf(size: BoxSize): TextStyle {
  const cached = styleCache.get(size)
  if (cached !== undefined) return cached
  const created = new TextStyle({ fontSize: BOX_FONT_SIZE[size], fill: BOX_INK })
  styleCache.set(size, created)
  return created
}

export class Box extends Container {
  /** 这块方块多大。调用方摆版式时读它，别去读 `width` / `height`（那两个跟着子节点走）。 */
  boxWidth: number
  boxHeight: number

  private readonly deps: BoxDeps
  private readonly frame = new Graphics()
  private readonly size: BoxSize
  private readonly align: 'center' | 'left'
  private text: Sprite | null = null
  private press: (() => void) | null = null
  private disabled = false

  constructor(options: BoxOptions, deps: BoxDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.size = options.size ?? 'body'
    this.align = options.align ?? 'center'
    this.addChild(this.frame)
    this.drawFrame()
    if (options.label !== undefined) this.setLabel(options.label)
    if (options.interactive === true) this.enablePointer()
  }

  /**
   * 换里面那行字。
   *
   * 换的是整张纹理（同 `Label`：烤好的字没有能改内容的东西），所以别在动画期间调它。
   * 这一批界面一局只变几次状态，都不在动画期间。
   */
  setLabel(content: string): void {
    const before = this.text
    if (before !== null) {
      this.removeChild(before)
      // 纹理归缓存共用，销毁精灵时不能跟着收。
      before.destroy({ texture: false, textureSource: false })
      this.text = null
    }
    if (content === '') return
    const texture = this.deps.text.get(`box|${this.size}|${content}`, content, styleOf(this.size))
    const sprite = new Sprite(texture)
    sprite.anchor.set(this.align === 'center' ? 0.5 : 0, 0.5)
    this.text = sprite
    this.addChild(sprite)
    this.placeText()
  }

  /** 点不点得动。只改透明度，不换颜色（见文件头）。 */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return
    this.disabled = disabled
    this.alpha = disabled ? BOX_DISABLED_ALPHA : 1
    if (this.eventMode === 'static') this.cursor = disabled ? 'default' : 'pointer'
  }

  /**
   * 改尺寸：重画边框、把字重新摆一遍。
   *
   * 覆盖的是 Pixi 自带的 `setSize`（那一个是靠缩放硬拉整棵子树的），
   * 这里改的是几何——描边被拉粗、字被拉变形都不是想要的。
   */
  override setSize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.drawFrame()
    this.placeText()
    if (this.eventMode === 'static') this.hitArea = new Rectangle(0, 0, width, height)
  }

  /** 按了叫谁。只有一个回调，后设的顶掉前一个；禁用时不会被调到。 */
  onPress(callback: () => void): void {
    this.press = callback
    this.enablePointer()
  }

  private enablePointer(): void {
    if (this.eventMode !== 'static') {
      this.eventMode = 'static'
      /*
       * 命中区显式给成整块矩形，不让 Pixi 按子节点包围盒算：描边是空心的，
       * 中间那一大片按包围盒算虽然点得中，但换了字之后包围盒会跟着字变，
       * 显式给一块才和画出来的边框永远对得上。
       */
      this.hitArea = new Rectangle(0, 0, this.boxWidth, this.boxHeight)
      this.on('pointertap', () => {
        if (this.disabled) return
        this.press?.()
      })
    }
    this.cursor = this.disabled ? 'default' : 'pointer'
  }

  /**
   * 画那圈边框。
   *
   * 矩形往里让半像素：1px 的描边是骑在路径上画的，贴着 0 画会有半像素落在画布外，
   * 上下左右四条边看上去粗细不一样。
   */
  private drawFrame(): void {
    this.frame
      .clear()
      .rect(0.5, 0.5, Math.max(1, this.boxWidth - 1), Math.max(1, this.boxHeight - 1))
      .stroke({ width: 1, color: BOX_LINE })
  }

  /**
   * 把字摆进方块里。
   *
   * 超宽的整体等比缩小（不换行也不裁字），同 `Label` 的 `maxWidth`：
   * 方块的宽度是版式算出来的，而文案长度千差万别，缩小是唯一不会把字挤没的办法。
   */
  private placeText(): void {
    const sprite = this.text
    if (sprite === null) return
    const room = Math.max(1, this.boxWidth - PAD_X * 2)
    sprite.scale.set(Math.min(1, room / sprite.texture.width))
    sprite.position.set(this.align === 'center' ? this.boxWidth / 2 : PAD_X, this.boxHeight / 2)
  }
}
