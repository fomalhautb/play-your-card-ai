/**
 * 夜色页面上那一栏人物说明：需求单的面板 N（英雄详情信息栏）。
 *
 * 内容是「名字 → 一行英文名 → 一条往右淡出的渐变带 →「小标题 + 一段正文」若干段」。
 * 正文靠 `Label` 的折行排（不是缩小），行高走下面那一档。
 *
 * 原先它还有一个变体 O（首页 hover 人物时浮出来的介绍卡），和 N 是同一块内容换一套字号
 * 和一条分隔线。首页那一层在正式版简化第 2 步整条删掉了，所以这里只剩 N 一档；
 * 编号变体的写法留着（需求单按编号认组件），再加一档时照旧往 `TYPE` 里添。
 *
 * 建好之后不改内容：换一个人就换一块 InfoCard（同 Label 的理由）。
 * 所以它没有任何 setter，只有一个淡入用的 `show()`。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量。 */
export type InfoCardVariant = 'N'

/** 英雄详情右侧那一栏。 */
export const INFO_CARD_HERO: InfoCardVariant = 'N'

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
  /** 英文名。不给就不摆那一行。 */
  enName?: string
  sections: InfoSection[]
  /**
   * 整体缩放系数。字号不是死数，而是「设计稿上的数 × 这个系数」，
   * 这样窄屏上整块能按比例收下去。不给就是 1。
   */
  scale?: number
}

/**
 * 排版档（设计稿 1440 宽下的 px 值，实际乘 `scale`）。
 * 数值抄需求单面板 N 那一条的「尺寸和关键值」。
 */
const TYPE = {
  N: {
    name: { size: 31.7, weight: '600' as const, color: tokens.color.hero.name },
    en: { size: 14.4, color: tokens.color.hero.goldDim },
    label: { size: 19.4, weight: '600' as const, color: tokens.color.hero.gold },
    copy: { size: 15.1, color: tokens.color.hero.body, lineHeight: 15.1 * 1.75 },
    gapName: 10,
    gapRule: 18,
    gapSection: 18,
    gapLabel: 8,
  },
} as const

/** 那条渐变分隔线的高。 */
const RULE_HEIGHT = 2

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
    y += this.addLine(options.name, type.name.size * scale, type.name.color, y, {
      weight: type.name.weight,
    }).textHeight
    if (options.enName !== undefined) {
      y += type.gapName * scale * 0.4
      const en = this.addLine(options.enName, type.en.size * scale, type.en.color, y)
      // 英文名比名字淡一档，它是补充不是标题。
      en.alpha = tokens.opacity.hero.en
      y += en.textHeight
    }

    y += type.gapRule * scale
    y += this.addRule(y)
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
  }

  /**
   * 建出来是藏着的，由调用方叫一次淡入。
   * 时长借首页那一档令牌（`duration.home.castFadeIn`）：它要的就是「浮出来的一块」那个节奏。
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

  /** 加一行不折行的字（名字、英文名、小标题）。返回它本身，调用方读 `textHeight` 往下摞。 */
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

  /** 分隔线：一条往右淡出的渐变带。返回它占的高。 */
  private addRule(y: number): number {
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
