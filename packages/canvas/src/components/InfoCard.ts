/**
 * 夜色页面上那一栏人物说明：需求单的面板 N（英雄详情信息栏）和面板 O（首页人物介绍卡）。
 *
 * 两者是**同一块内容**换一套字号和一条分隔线：名字 → 分隔 →「小标题 + 一段正文」若干段。
 * N 多一行英文名、分隔线是一条往右淡出的渐变带；O 多一行眉标「角色档案」、
 * 分隔线是那支星芒花饰（边框 C）。除此之外连排版逻辑都一样，所以是一个组件两个变体。
 *
 * 底板只有 O 有，而且只有薄薄一层压暗：需求单面板 O 那条没截到图（首页的人物命中当时没做出来），
 * 旧版也确实没有底——但旧版那块字浮的是一片夜空，而正式版这幅画里七个人挤满了整个画面，
 * 米色字压在人脸和衣褶上根本读不出来。所以这里加一层几乎看不见的压暗兜住可读性，
 * **不加边框、不加纸纹**，远看仍然是「字浮在画上」。N 不需要：它压的是暗幕。
 * 正文靠 `Label` 的折行排（不是缩小），行高走各变体自己那一档。
 *
 * 建好之后不改内容：换一个人就换一块 InfoCard（同 Label 的理由）。
 * 所以它没有任何 setter，只有一个淡入用的 `show()`。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics, Sprite } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Flourish } from './Flourish'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量。 */
export type InfoCardVariant = 'N' | 'O'

/** 英雄详情右侧那一栏。 */
export const INFO_CARD_HERO: InfoCardVariant = 'N'
/** 首页 hover 人物时浮出来的那一小块。 */
export const INFO_CARD_CAST: InfoCardVariant = 'O'

export interface InfoCardDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

/** 一段说明：一行小标题加一段正文。 */
export interface InfoSection {
  label: string
  text: string
}

export interface InfoCardOptions {
  variant: InfoCardVariant
  /** 整栏多宽。高度由内容撑出来，建完读 `boxHeight`。 */
  width: number
  name: string
  /** 英文名，只有变体 N 摆。 */
  enName?: string
  sections: InfoSection[]
  /**
   * 整体缩放系数。首页那一版跟着舞台一起缩（旧版的排版单位是 cqi），
   * 所以字号不是死数，而是「设计稿上的数 × 这个系数」。不给就是 1。
   */
  scale?: number
}

/**
 * 两个变体各自的排版档（设计稿 1672 宽 / 1440 宽下的 px 值，实际乘 `scale`）。
 * 数值抄需求单面板 N、面板 O 两条的「尺寸和关键值」。
 */
const TYPE = {
  N: {
    kicker: null,
    name: { size: 31.7, weight: '600' as const, color: tokens.color.hero.name },
    en: { size: 14.4, color: tokens.color.hero.goldDim },
    label: { size: 19.4, weight: '600' as const, color: tokens.color.hero.gold },
    copy: { size: 15.1, color: tokens.color.hero.body, lineHeight: 15.1 * 1.75 },
    gapName: 10,
    gapRule: 18,
    gapSection: 18,
    gapLabel: 8,
  },
  O: {
    kicker: { size: 12.6, color: tokens.color.home.ink },
    name: { size: 19.4, weight: '600' as const, color: tokens.color.home.inkLit },
    en: null,
    label: { size: 13.4, weight: '600' as const, color: tokens.color.home.ink },
    copy: { size: 14.7, color: tokens.color.home.cast, lineHeight: 14.7 * 1.7 },
    gapName: 8,
    gapRule: 14,
    gapSection: 14,
    gapLabel: 6,
  },
} as const

/** 变体 O 的眉标文案。它是这一块的身份说明，不随人变，所以写在组件里。 */
const CAST_KICKER = '角色档案'
/** 变体 N 那条渐变分隔线的高。 */
const RULE_HEIGHT = 2
/** 变体 O 那层压暗：往外扩多少、圆角多大、多不透明。 */
const SCRIM = { pad: 14, radius: 10, alpha: 0.52 }

export class InfoCard extends Container {
  readonly boxWidth: number
  readonly boxHeight: number

  private readonly deps: InfoCardDeps

  constructor(options: InfoCardOptions, deps: InfoCardDeps) {
    super()
    this.deps = deps
    this.label = `info-card:${options.variant}`
    const scale = options.scale ?? 1
    const type = TYPE[options.variant]
    this.boxWidth = options.width

    let y = 0
    if (type.kicker !== null) {
      const kicker = this.addLine(CAST_KICKER, type.kicker.size * scale, type.kicker.color, y, {
        spacingEm: 0.24,
      })
      y += kicker.textHeight + type.gapName * scale * 0.5
    }
    y += this.addLine(options.name, type.name.size * scale, type.name.color, y, {
      weight: type.name.weight,
    }).textHeight
    if (type.en !== null && options.enName !== undefined) {
      y += type.gapName * scale * 0.4
      const en = this.addLine(options.enName, type.en.size * scale, type.en.color, y)
      // 英文名比名字淡一档，它是补充不是标题。
      en.alpha = tokens.opacity.hero.en
      y += en.textHeight
    }

    y += type.gapRule * scale
    y += this.addRule(options.variant, y, scale)
    y += type.gapRule * scale

    options.sections.forEach((section, index) => {
      if (index > 0) y += type.gapSection * scale
      y += this.addLine(section.label, type.label.size * scale, type.label.color, y, {
        weight: type.label.weight,
        spacingEm: 0.12,
      }).textHeight
      y += type.gapLabel * scale
      y += this.addCopy(section.text, type.copy, scale, y)
    })

    this.boxHeight = y
    if (options.variant === 'O') this.addScrim(scale)
  }

  /**
   * 变体 O 背后那层压暗。建完才知道整块多高，所以最后画、再塞到最底下。
   * 只有一块半透明的圆角矩形：不画边框也不画纸纹，它要的是「读得清」而不是「像一块牌子」。
   */
  private addScrim(scale: number): void {
    const pad = SCRIM.pad * scale
    const plate = new Graphics()
      .roundRect(
        -pad,
        -pad,
        this.boxWidth + pad * 2,
        this.boxHeight + pad * 2,
        SCRIM.radius * scale,
      )
      .fill({ color: tokens.color.overlay.dialog, alpha: SCRIM.alpha })
    this.addChildAt(plate, 0)
  }

  /**
   * 建出来是藏着的，由调用方叫一次淡入。
   * 时长走首页那一档（`duration.home.castFadeIn`）：两个变体都是「浮出来的一块」。
   */
  show(delaySeconds = 0): void {
    this.alpha = 0
    this.deps.animator.tween(this, {
      alpha: 1,
      duration: tokens.duration.home.castFadeIn,
      delay: delaySeconds,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }

  /** 加一行不折行的字（眉标、名字、小标题）。返回它本身，调用方读 `textHeight` 往下摞。 */
  private addLine(
    content: string,
    fontSize: number,
    color: string,
    y: number,
    style: { weight?: '400' | '600'; spacingEm?: number } = {},
  ): Label {
    const line = new Label(
      content,
      {
        fontSize,
        weight: style.weight ?? '400',
        letterSpacing: fontSize * (style.spacingEm ?? 0),
        maxWidth: this.boxWidth,
        align: 'left',
      },
      this.deps,
      color,
    )
    // Label 的原点在文字**中线**上（anchor 0.5），而这里是从上往下摞，所以要落半行。
    line.position.set(0, y + line.textHeight / 2)
    this.addChild(line)
    return line
  }

  /** 加一段折行的正文，返回它占的高。 */
  private addCopy(
    content: string,
    copy: { size: number; color: string; lineHeight: number },
    scale: number,
    y: number,
  ): number {
    const block = new Label(
      content,
      {
        fontSize: copy.size * scale,
        wrapWidth: this.boxWidth,
        lineHeight: copy.lineHeight * scale,
        align: 'left',
      },
      this.deps,
      copy.color,
    )
    block.position.set(0, y + block.textHeight / 2)
    this.addChild(block)
    return block.textHeight
  }

  /** 分隔线：N 是一条往右淡出的渐变带，O 是那支星芒花饰。返回它占的高。 */
  private addRule(variant: InfoCardVariant, y: number, scale: number): number {
    if (variant === 'O') {
      const star = 13 * scale
      const rule = new Flourish({ width: this.boxWidth, starSize: star, sides: 'both' }, this.deps)
      rule.position.set(0, y)
      this.addChild(rule)
      return rule.boxHeight
    }
    const bar = new Sprite(this.deps.ui.ramp)
    bar.anchor.set(0, 0)
    bar.width = this.boxWidth
    bar.height = RULE_HEIGHT
    bar.tint = tokens.color.hero.gold
    bar.alpha = tokens.opacity.home.flourishLine
    // 渐变带本身是从透明走到实的，这里要的是从实到透明，所以左右翻转。
    bar.scale.x = -bar.scale.x
    bar.position.set(this.boxWidth, y)
    this.addChild(bar)
    return RULE_HEIGHT
  }
}
