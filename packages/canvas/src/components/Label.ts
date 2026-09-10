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
import { Container, Sprite, TextStyle, Texture } from 'pixi.js'
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
  /**
   * 只露出左边一截时用的那张纹理：和烤好的那张共用同一份 source，只是自己带一个可改的取样框。
   * 没调过 `setReveal` 的 Label 不建它。
   */
  private revealTexture: Texture | null = null

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

  /**
   * 只露出左边这一段（0 到 1），右边裁掉。打字机效果就是把它从 0 补到 1。
   *
   * 做法是改**取样框**，不是上遮罩。遮罩两条路都不能走：
   * 用 Sprite 当遮罩 Pixi 会走 AlphaMask，那是一趟离屏渲染（纪律 3.1 要求离屏为 0）；
   * 用 Graphics 当遮罩走 StencilMask，离屏是没有了，但每帧要动一次模板缓冲——
   * 无头软件渲染下实测一帧从几十毫秒涨到几百毫秒，性能剧本里的结算那段直接跑不完。
   * 改取样框只是换四个 uv，画的还是同一个四边形，一分钱不多花。
   *
   * 纹理里的字是从左往右排的，所以裁右边就等于「还没打到那儿」。
   * 只对**靠左对齐**（`align: 'left'`）的 Label 有意义：居中的锚点在中间，裁窄之后
   * 是从两边一起缩，不是从右边擦。现在也只有结算层的打字机在用它。
   */
  setReveal(fraction: number): void {
    const texture = this.revealTexture ?? this.makeRevealTexture()
    // 宽度不能是 0：Pixi 会拿它算 uv，除下来是 NaN。留一个像素，视觉上等同于没露出来。
    texture.frame.width = Math.max(
      1,
      Math.round(this.textWidth * Math.min(1, Math.max(0, fraction))),
    )
    texture.update()
  }

  /**
   * 建那张自带取样框的纹理。
   *
   * `orig` 不单独传：Pixi 的 `Texture` 在没给 `orig` 时会让它和 `frame` 指同一个矩形，
   * 于是改一处宽度，取样框和「这张图有多大」一起变——精灵的尺寸才会跟着缩，
   * 而不是把原图横向压扁。`dynamic` 也必须开，否则精灵不会订阅纹理的更新。
   */
  private makeRevealTexture(): Texture {
    const base = this.sprite.texture
    // frame 传原来那个就行：`Texture` 的构造函数是 copyFrom 进自己那份的，不会写到别人身上。
    const texture = new Texture({ source: base.source, frame: base.frame, dynamic: true })
    this.revealTexture = texture
    this.sprite.texture = texture
    return texture
  }

  /** 自己那张取样框纹理归自己销毁；底下的 source 是缓存里共用的，不能跟着销毁。 */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.revealTexture?.destroy(false)
    this.revealTexture = null
    super.destroy(options)
  }
}
