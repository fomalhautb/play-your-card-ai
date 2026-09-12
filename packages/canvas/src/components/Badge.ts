/**
 * 徽章：需求单的徽章 A（费用圆章）、B（问号帮助圆章）、C（卡面铭牌）、
 * D（卡角状态角标）、I（敬请期待角标）。
 *
 * 原来还有 E（中线回合徽章）。正式版简化第 4 步之二把战场中线那块匾换成素方块之后
 * 它没有调用方了，连同它那几个令牌一起不再用。
 *
 * A 和 C 原本只长在 CardSprite 里，现在**形状**搬去了 fx/badgeShapes.ts，两边共用一份定义。
 * 搬的只有形状，不是显示对象：卡面上的每一层都要过透视投影、是四边形网格
 *（见 CardSprite 的文件头），而这里是一个普通容器，挂到卡上就没有近大远小了。
 * 所以 CardSprite 仍然自己建网格，只是画法不再有第二份——截图基线因此不该变。
 *
 * D 是一颗药丸：底 + 一圈描边 + 一行字，全靠 tint 和 alpha 上色。
 * 药丸用九宫格（Pixi 自带的 NineSliceSprite），高固定 20、只横向拉伸，
 * 圆头永远是正圆——纯拉伸会把它压成椭圆。
 *
 * I 不走药丸那条路：它的圆角只有 3.6px，用药丸的九宫格画出来是一颗胶囊，
 * 而设计稿上它是一块方方正正的小牌。这一枚直接用 Graphics 画一个圆角矩形，
 * 建的时候画一次、之后不再动（3.10 管的是动画期间，不是建对象那一下）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics, NineSliceSprite, Sprite, type Texture } from 'pixi.js'
import { PILL_BASE, PILL_INSET } from '../fx/badgeShapes'
import type { UiTextures } from '../fx/uiTextures'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量。 */
export type BadgeVariant = 'A' | 'B' | 'C' | 'D' | 'I'

export const BADGE_COST: BadgeVariant = 'A'
export const BADGE_HELP: BadgeVariant = 'B'
export const BADGE_NAMEPLATE: BadgeVariant = 'C'
export const BADGE_TILE_MARK: BadgeVariant = 'D'
/** 「敬请期待」：压在还没实装的英雄卡上的那块米色小牌。 */
export const BADGE_SOON: BadgeVariant = 'I'

/**
 * 卡角角标的四档配色。
 *
 * 分四档不是为了好看：小卡上每枚角标只有两三个字，光靠读字要眯着眼看半天，
 * 而「被干扰 / 被保住 / 变强了 / 变弱了」是玩家当场要做决策的信息。
 * 文案表在旧版 `ui/tileMarks.ts`（复读中、已颠倒、已净化、保送、金钟罩、
 * 已进化、已升级、已降级），那张表跟着引擎的 affectedBy 走，属于场景的活，不在这里。
 */
export type BadgeTone = 'amber' | 'up' | 'down' | 'safe'

const TONES: Record<BadgeTone, { line: string; ink: string; lineAlpha: number }> = {
  amber: {
    line: tokens.color.mark.amber.line,
    ink: tokens.color.mark.amber.ink,
    lineAlpha: tokens.opacity.mark.amberLine,
  },
  up: {
    line: tokens.color.mark.up.line,
    ink: tokens.color.mark.up.ink,
    lineAlpha: tokens.opacity.mark.upLine,
  },
  down: {
    line: tokens.color.mark.down.line,
    ink: tokens.color.mark.down.ink,
    lineAlpha: tokens.opacity.mark.downLine,
  },
  safe: {
    line: tokens.color.mark.safe.line,
    ink: tokens.color.mark.safe.ink,
    lineAlpha: tokens.opacity.mark.safeLine,
  },
}

/** 角标里那行字的字号，和旧样式的 `--fs-xs` 同一档。 */
const MARK_FONT_SIZE = tokens.font.size.xs
/** 角标左右各留多少。抄旧样式的 `padding: 2px 7px`。 */
const MARK_PAD_X = 7

/** 问号帮助章里那个「?」的字号，按圆章直径取比例。 */
const HELP_FONT_RATIO = 0.68
/** 费用数字的字号，按圆章直径取比例。和 CardSprite 用的是同一个比例。 */
const COST_FONT_RATIO = 0.52
/** 「敬请期待」那块小牌的设计尺寸，抄需求单徽章 I 那条（103×31、圆角 3.6、13.7px 字）。 */
const SOON = { height: 31, padX: 16, radius: 3.6, fontSize: 13.7 } as const

export interface BadgeDeps {
  ui: UiTextures
  text: TextTextureCache
}

export type BadgeOptions =
  /** 费用圆章。盘底按各张牌的主色上色（旧版 AI_MODEL_FACE 的 accent）。 */
  | { variant: 'A'; cost: number; accent: string }
  /** 问号帮助圆章。不吃指针事件，翻面的热区归各页自己管。 */
  | { variant: 'B'; size?: number }
  /** 卡面铭牌。上面印一行模型名。 */
  | { variant: 'C'; name: string }
  /** 卡角状态角标。 */
  | { variant: 'D'; text: string; tone: BadgeTone }
  /** 中线回合徽章。 */
  /**
   * 敬请期待角标。`scale` 是整块相对设计稿（103×31）的倍数——
   * 英雄卡在两档版式下大小差一倍多，角标要跟着卡一起缩才压得住。
   */
  | { variant: 'I'; text: string; scale?: number }

export class Badge extends Container {
  readonly variant: BadgeVariant
  /** 这枚徽章占多宽多高。角标和回合徽章的宽度跟着文字走，摆版式要按它算。 */
  readonly boxWidth: number
  readonly boxHeight: number

  constructor(options: BadgeOptions, deps: BadgeDeps) {
    super()
    this.variant = options.variant
    // 徽章一律是纯显示，旧版几处都写着 pointer-events: none。
    this.eventMode = 'none'

    switch (options.variant) {
      case 'A': {
        const size = deps.ui.costBadge.width
        this.addDisc(deps.ui.costBadge, size, options.accent)
        this.addCentered(
          deps,
          String(options.cost),
          size * COST_FONT_RATIO,
          tokens.color.paper.base,
          size,
          '700',
        )
        this.boxWidth = size
        this.boxHeight = size
        break
      }
      case 'B': {
        const size = options.size ?? tokens.size.seal.helpMark
        this.addDisc(deps.ui.sealDisc, size, tokens.color.seal.base, tokens.opacity.seal.base)
        this.addDisc(deps.ui.sealRing, size, tokens.color.seal.mark)
        this.addCentered(deps, '?', size * HELP_FONT_RATIO, tokens.color.seal.mark, size, '600')
        this.boxWidth = size
        this.boxHeight = size
        break
      }
      case 'C': {
        const plate = new Sprite(deps.ui.nameplate)
        this.addChild(plate)
        this.boxWidth = plate.width
        this.boxHeight = plate.height
        this.addCentered(
          deps,
          options.name,
          14,
          tokens.color.battle.ink,
          this.boxWidth,
          '600',
          this.boxHeight / 2,
          this.boxWidth - 24,
        )
        break
      }
      case 'D': {
        const tone = TONES[options.tone]
        this.boxHeight = PILL_BASE.height
        this.boxWidth = this.addPill(
          deps,
          options.text,
          MARK_FONT_SIZE,
          tone.ink,
          tokens.color.mark.base,
          tokens.opacity.mark.base,
          tone.line,
          tone.lineAlpha,
        )
        break
      }
      case 'I': {
        const scale = options.scale ?? 1
        const label = new Label(
          options.text,
          {
            fontSize: SOON.fontSize * scale,
            weight: '600',
            letterSpacing: SOON.fontSize * scale * 0.2,
          },
          deps,
          tokens.color.soon.ink,
        )
        this.boxWidth = Math.round(label.textWidth) + SOON.padX * 2 * scale
        this.boxHeight = SOON.height * scale
        const plate = new Graphics()
          .roundRect(0, 0, this.boxWidth, this.boxHeight, SOON.radius * scale)
          .fill({ color: tokens.color.soon.fill })
          .stroke({
            width: 1,
            color: tokens.color.soon.line,
            alpha: tokens.opacity.soon.line,
            alignment: 1,
          })
        this.addChild(plate)
        label.position.set(this.boxWidth / 2, this.boxHeight / 2)
        this.addChild(label)
        break
      }
    }
  }

  /** 摆一层圆形的底或圈。模具是 64px 的，缩到实际直径。 */
  private addDisc(texture: Texture, size: number, color: string, alpha = 1): void {
    const sprite = new Sprite(texture)
    sprite.setSize(size, size)
    sprite.tint = color
    sprite.alpha = alpha
    this.addChild(sprite)
  }

  /** 在盒子正中印一行字。 */
  private addCentered(
    deps: BadgeDeps,
    content: string,
    fontSize: number,
    color: string,
    boxWidth: number,
    weight: '400' | '600' | '700',
    centerY = boxWidth / 2,
    maxWidth?: number,
  ): void {
    const label = new Label(content, { fontSize, weight, maxWidth }, deps, color)
    label.position.set(boxWidth / 2, centerY)
    this.addChild(label)
  }

  /**
   * 药丸型徽章（角标和回合徽章共用）：底 + 描边 + 一行字，宽度跟着文字走。
   *
   * 九宫格的四条边都取圆头的半径，于是中间那一行的高度是零——只有横向会被拉伸，
   * 圆头保持正圆。返回算出来的总宽。
   */
  private addPill(
    deps: BadgeDeps,
    content: string,
    fontSize: number,
    ink: string,
    fill: string,
    fillAlpha: number,
    line: string,
    lineAlpha: number,
    padX = MARK_PAD_X,
    inkAlpha = 1,
  ): number {
    const label = new Label(content, { fontSize, weight: '400' }, deps, ink)
    label.alpha = inkAlpha
    const width = Math.max(PILL_BASE.height, Math.round(label.textWidth) + padX * 2)
    const height = this.boxHeight
    for (const [texture, color, alpha] of [
      [deps.ui.pillFill, fill, fillAlpha],
      [deps.ui.pillLine, line, lineAlpha],
    ] as const) {
      const slice = new NineSliceSprite({
        texture,
        leftWidth: PILL_INSET,
        rightWidth: PILL_INSET,
        topHeight: PILL_INSET,
        bottomHeight: PILL_INSET,
        width,
        height,
      })
      slice.tint = color
      slice.alpha = alpha
      this.addChild(slice)
    }
    label.position.set(width / 2, height / 2)
    this.addChild(label)
    return width
  }
}
