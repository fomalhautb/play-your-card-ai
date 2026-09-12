/**
 * 画布上的一段文字。
 *
 * 它存在的唯一理由是把 3.5 那条（文字只创建一次并缓存）变成结构上做不到别的：
 * 建好之后这个对象里**没有任何能改文字内容的东西**，场景图里挂的是一张烤好的纹理，
 * 不是 Text 对象。要换内容就得换一个 Label——那一步会不会发生在动画期间，写的人看得见。
 *
 * 颜色不烤进纹理，走 tint。这样「同一句话、同一个字号、两种颜色」只占一张纹理，
 * 而且换色（按钮悬停、禁用）只是写一个属性，不重建任何东西（3.10）。
 * 代价是纹理里的字必须是纯白的，所以下面建 TextStyle 时 fill 写死 0xffffff。
 *
 * 字体阶段一用系统衬线体（`font.family.serif` 的兜底那几档），第 34 条一致性检查之前
 * 不自托管子集化（4.1）。所以目录页基线图上的字形跟着机器走，基线必须按平台分目录。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite, TextStyle } from 'pixi.js'
import type { TextTextureCache } from '../runtime/textCache'

export interface LabelStyle {
  /** 字号（px）。按钮那几档是中号字，旧样式里就地写死、互不成阶梯，所以不进令牌。 */
  fontSize: number
  /** 字重。旧样式用到的只有常规和 600 两档。 */
  weight?: '400' | '600' | '700'
  /**
   * 字距（px）。旧样式写的是 em，换算过来就是 `字号 × em 值`。
   * 和 CSS 一样，最后一个字后面也会留一份，居中时要补回来——见下面的 trailing。
   */
  letterSpacing?: number
  /**
   * 最大宽度（px）。超了就整体等比缩小，不换行也不裁字。
   *
   * 等比而不是只压横向：旧版用 SVG 的 `textLength` + `lengthAdjust` 只压横向，
   * 那是被 SVG 的能力限制的；等比缩出来字形不变形，读起来更像同一套字。
   */
  maxWidth?: number
  /** 横向对齐。决定原点在文字的哪一侧，默认居中。 */
  align?: 'center' | 'left'
}

/** 两个 Label 只要这几项一样，就该共用同一张纹理。 */
function textureKey(content: string, style: LabelStyle): string {
  return `label|${style.fontSize}|${style.weight ?? '400'}|${style.letterSpacing ?? 0}|${content}`
}

/**
 * TextStyle 全局缓存。
 *
 * TextStyle 一变就要重新量文字，而同一档样式常常有几十段文字在用（角标、按钮、铭牌），
 * 各建一份纯属浪费。键和纹理的键差一段内容——样式本身和内容无关。
 */
const styleCache = new Map<string, TextStyle>()

function styleOf(style: LabelStyle): TextStyle {
  const key = `${style.fontSize}|${style.weight ?? '400'}|${style.letterSpacing ?? 0}`
  const cached = styleCache.get(key)
  if (cached !== undefined) return cached
  const created = new TextStyle({
    fontFamily: tokens.font.family.serif,
    fontSize: style.fontSize,
    fontWeight: style.weight ?? '400',
    letterSpacing: style.letterSpacing ?? 0,
    // 白色是 tint 的前提，见文件头。
    fill: 0xffffff,
  })
  styleCache.set(key, created)
  return created
}

export class Label extends Container {
  /** 这张纹理原本多大（还没被 maxWidth 压过）。摆版式时按它算行高。 */
  readonly textWidth: number
  readonly textHeight: number

  private readonly sprite: Sprite

  constructor(
    content: string,
    style: LabelStyle,
    deps: { text: TextTextureCache },
    color: string = tokens.color.paper.ink,
  ) {
    super()
    const texture = deps.text.get(textureKey(content, style), content, styleOf(style))
    this.textWidth = texture.width
    this.textHeight = texture.height

    const scale = style.maxWidth === undefined ? 1 : Math.min(1, style.maxWidth / texture.width)
    const centered = (style.align ?? 'center') === 'center'
    this.sprite = new Sprite(texture)
    this.sprite.anchor.set(centered ? 0.5 : 0, 0.5)
    this.sprite.scale.set(scale)
    /*
     * 字距会在最后一个字后面也留一份，于是整段看着偏左。居中时把原点往右挪半份补回来，
     * 就是旧样式里那句 `text-indent: 0.25em` 干的事。靠左对齐的不用补：
     * 那一份多出来的空白落在段尾，不影响起点。
     */
    if (centered) this.sprite.x = ((style.letterSpacing ?? 0) * scale) / 2
    this.sprite.tint = color
    this.addChild(this.sprite)
  }

  /** 换个颜色。走 tint，不重建纹理。 */
  setColor(color: string): void {
    this.sprite.tint = color
  }
}
