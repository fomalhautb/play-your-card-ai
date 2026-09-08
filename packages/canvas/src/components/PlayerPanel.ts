/**
 * 侧栏里的一块玩家面板：一圈雕花框（需求单边框 A）里摆一张英雄牌，
 * 牌下压一块铭牌（徽章 C）写名字，右缘可以挂一条 Token 细条（面板 E）。
 *
 * 组件是哑的：`setName` / `setHero` / `setScore` / `setTokens` 由场景在收到 cue 时调，
 * 它自己不认识引擎。尺寸由调用方给（`resize`）——桌面和手机是两档并列的版式，
 * 侧栏宽度不同，这块面板跟着变。
 *
 * 和旧版的两处出入，都是有意的：
 * 1. 旧版这块面板上**不画**名字和比分（比分在顶栏，谁是谁靠上下位置分），这里两样都能画。
 *    多出来的两个方法是给两档版式留的余地：手机档没有那条横贯的顶栏，比分只能落在这儿。
 *    不设就不画（`setName(null)` / `setScore(null)`），桌面档照旧和旧版一样干净。
 * 2. 旧版的 Token 细条贴在**战场右缘**、独立于侧栏，这里挂在面板上。合在一起是因为
 *    「谁还剩几点」本来就是这块面板要回答的事，而且合了之后场景摆版式只用摆一样东西。
 *    细条有固定高度（令牌 `size.rail.height` 470），装不进面板时整条等比缩小——
 *    缩的是 Container 的 scale，属于 transform，不重画里面任何一颗星。
 *
 * 卡堆（旧版压在英雄牌一角的那摞牌背）不在这里：它是发牌动画的起飞点，
 * 归场景摆（`scenes/duelLayout.ts` 里已经有 `deck` 那一项）。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Badge } from './Badge'
import type { CardSprite } from './CardSprite'
import { Label } from './Label'
import { OrnateFrame } from './OrnateFrame'
import { TokenRail } from './TokenRail'

/**
 * 这块面板自己的字号（px）。按 design 的 README「组件私有字号」那条留在组件里。
 * 比分那一档和顶栏的比分数字同大小——两处说的是同一件事，换版式时只会用其中一处。
 */
const TYPE = { score: { fontSize: 30, letterSpacing: 0 } } as const

/** 英雄牌四周离雕花框留多宽。旧版是面板内边距 18，这里连框宽一起算。 */
const CARD_INSET = 22
/** 铭牌压在英雄牌下沿往上多少。旧版铭牌是卡面的一部分，这里单独一块，压在牌脚上。 */
const PLATE_LIFT = 10
/** 细条离面板右缘多远。贴着框内侧摆。 */
const RAIL_INSET = 6

export interface PlayerPanelDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export interface PlayerPanelOptions {
  width: number
  height: number
  /** 挂不挂 Token 细条。旧版只有我方那侧有，对方那侧看不到对手还剩几点。 */
  tokens?: boolean
}

export class PlayerPanel extends Container {
  private readonly deps: PlayerPanelDeps
  private readonly frame: OrnateFrame
  /** 英雄牌挂在这一层。放大查看把牌借走时，这一层留着占位（见 setHeroHeld）。 */
  private readonly heroSlot = new Container()
  private readonly plateSlot = new Container()
  private readonly scoreSlot = new Container()
  private readonly rail: TokenRail | null

  private boxWidth: number
  private boxHeight: number
  private hero: CardSprite | null = null
  private heroName: string | null = null
  private score: number | null = null

  constructor(options: PlayerPanelOptions, deps: PlayerPanelDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.label = 'player-panel'

    this.frame = new OrnateFrame(options.width, options.height, deps)
    this.rail = options.tokens === true ? new TokenRail(deps) : null
    this.addChild(this.heroSlot, this.plateSlot, this.scoreSlot, this.frame)
    if (this.rail !== null) this.addChild(this.rail)
    this.layout()
  }

  /** 改大小。框重排、里面的东西重新摆位，一个对象都不重建。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.frame.resize(width, height)
    this.layout()
  }

  /**
   * 换英雄牌。传 null 摘掉（还没选英雄）。
   * 卡由调用方建也由调用方销毁——canvas 不管资源从哪来，这里只借来摆。
   */
  setHero(card: CardSprite | null): void {
    this.heroSlot.removeChildren()
    this.hero = card
    if (card !== null) this.heroSlot.addChild(card)
    this.layout()
  }

  /**
   * 这张英雄牌此刻被放大查看借走了：原位让出来但**格子还占着**。
   * 用 visible 而不是把卡摘掉，是为了飞回来时位置还在（同旧版 `.battle__hero--held`）。
   */
  setHeroHeld(held: boolean): void {
    this.heroSlot.visible = !held
  }

  /** 英雄牌的中心（这块面板自己的坐标）。放大查看要拿它当起飞点和落点。 */
  heroCenter(): { x: number; y: number } {
    return { x: this.boxWidth / 2, y: this.heroSlot.y - (CARD_HEIGHT * this.heroScale()) / 2 }
  }

  /** 铭牌上那行名字。传 null 就不画（桌面档旧版本来就不画）。 */
  setName(name: string | null): void {
    if (this.heroName === name) return
    this.heroName = name
    for (const child of this.plateSlot.removeChildren()) child.destroy({ children: true })
    if (name !== null) {
      // 字面量 'C' 就是 BADGE_NAMEPLATE（卡面铭牌），写字面量的理由同 BoardGrid。
      this.plateSlot.addChild(new Badge({ variant: 'C', name }, this.deps))
    }
    this.layout()
  }

  /** 这一侧的比分。传 null 就不画。 */
  setScore(score: number | null): void {
    if (this.score === score) return
    this.score = score
    for (const child of this.scoreSlot.removeChildren()) child.destroy({ children: true })
    if (score !== null) {
      this.scoreSlot.addChild(
        new Label(String(score), TYPE.score, this.deps, tokens.color.battle.navy),
      )
    }
    this.layout()
  }

  /** 剩余 Token。没挂细条的那一侧调它没有效果。 */
  setTokens(current: number, max: number): void {
    this.rail?.setTokens(current, max)
  }

  /**
   * 英雄牌缩到多大：宽高两边能容下的较小值，也就是「2:3 塞满这块面板」。
   * 挂了细条的那一侧要先让开细条占的宽。
   */
  private heroScale(): number {
    const railWidth = this.rail === null ? 0 : this.rail.boxWidth + RAIL_INSET
    const usableWidth = this.boxWidth - CARD_INSET * 2 - railWidth
    const usableHeight = this.boxHeight - CARD_INSET * 2
    return Math.max(0, Math.min(usableWidth / CARD_WIDTH, usableHeight / CARD_HEIGHT))
  }

  /** 把英雄牌、铭牌、比分和细条摆好。全是写 position 和 scale，不重建任何对象。 */
  private layout(): void {
    const scale = this.heroScale()
    const railWidth = this.rail === null ? 0 : this.rail.boxWidth + RAIL_INSET
    // 卡的原点在底边中点（见 CardSprite 的坐标约定），所以这一层摆的是卡脚的位置。
    const cardCenterX = (this.boxWidth - railWidth) / 2
    const cardBottom = (this.boxHeight + CARD_HEIGHT * scale) / 2
    this.heroSlot.position.set(cardCenterX, cardBottom)
    this.hero?.scale.set(scale)

    const plate = this.plateSlot.children[0]
    if (plate !== undefined)
      plate.position.set(cardCenterX - plate.width / 2, cardBottom - PLATE_LIFT - plate.height)

    const label = this.scoreSlot.children[0]
    if (label !== undefined) label.position.set(cardCenterX, CARD_INSET)

    if (this.rail !== null) {
      // 细条比面板高就整条缩进来，缩的是 transform，里面的星星一颗都不重画。
      const fit = Math.min(1, (this.boxHeight - CARD_INSET) / this.rail.boxHeight)
      this.rail.scale.set(fit)
      this.rail.position.set(
        this.boxWidth - RAIL_INSET - this.rail.boxWidth * fit,
        (this.boxHeight - this.rail.boxHeight * fit) / 2,
      )
    }
  }
}
