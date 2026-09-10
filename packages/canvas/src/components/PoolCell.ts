/**
 * 卡池里的一格：一张卡，加上「带了几份」的角标、一颗「＋」，以及选不了时正中那块牌子。
 *
 * **不导出**（同 BoardTile、SettleRow 那几个）：它只对构筑页的卡池负责，
 * 拆成文件是被 400 行那条上限逼的，不是多了一个可以单独用的组件。
 *
 * 格子是**长住**的：卡池一页最多八格，翻页时只换里面那张卡（`setCard`），
 * 格子本身、「＋」和角标一次都不重建——翻页是这一页最频繁的动作，
 * 随建随销的话每翻一页就是一屏的对象分配（6.9 的「稳态每帧堆分配」量的正是这个）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import { CARD_HEIGHT } from '../layout/fanMath'
import type { TextTextureCache } from '../runtime/textCache'
import { Badge, type BadgeDeps } from './Badge'
import type { CardSprite } from './CardSprite'
import { SmallButton, type SmallButtonDeps } from './SmallButton'

/**
 * 「＋」那枚圆章的直径，以及它离格子**右上角**多远。
 *
 * 摆右上角而不是旧版的右下角：卡面底部有一条印着模型名的铭牌，圆章压上去正好盖住名字，
 * 而小格子上那行名字本来就将将够看。左上角让给「带了几份」的角标。
 */
const ADD = { size: 26, inset: 4 }
/** 角标离格子左上角多远。 */
const BADGE_INSET = 4

export type PoolCellDeps = SmallButtonDeps & BadgeDeps & { text: TextTextureCache }

export interface PoolCellOptions {
  /** 格子多宽多高。由版式给。 */
  width: number
  height: number
  /** 卡缩到多大（基准 150×225）。 */
  cardScale: number
  /** 点了这一格的「＋」。 */
  onAdd?: () => void
}

export class PoolCell extends Container {
  private readonly deps: PoolCellDeps
  private readonly slot = new Container()
  private readonly marks = new Container()
  private readonly blockedSlot = new Container()
  private readonly add: SmallButton
  private readonly veil = new Graphics()
  private boxWidth: number
  private boxHeight: number
  private cardScale: number
  private card: CardSprite | null = null
  private copies = 0
  private blocked: string | null = null

  constructor(options: PoolCellOptions, deps: PoolCellDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.cardScale = options.cardScale
    this.add = new SmallButton(
      { variant: 'J', glyph: 'plus', size: ADD.size, onActivate: options.onAdd },
      deps,
    )
    // 压暗层不吃指针：点卡面是放大查看，不该被这一层截走。
    this.veil.eventMode = 'none'
    this.marks.eventMode = 'none'
    this.blockedSlot.eventMode = 'none'
    this.addChild(this.slot, this.veil, this.marks, this.blockedSlot, this.add)
    this.place()
  }

  /** 换格子的大小（改视口时）。 */
  resize(width: number, height: number, cardScale: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.cardScale = cardScale
    this.place()
  }

  /**
   * 摆一张卡进来（`null` 就是这一格这一页没有牌）。
   *
   * 卡由**调用方建、调用方回收**（见 scenes/deck/cards.ts 的回收池）：
   * 它随时可能被拖出去、飞回来，格子只是借来摆一会儿。
   */
  setCard(card: CardSprite | null): void {
    // 同一张、而且还挂在这一格上：什么都不用做。翻页之外的绝大多数重排走的都是这条。
    if (card === this.card && (card === null || card.parent === this.slot)) return
    this.slot.removeChildren()
    this.card = card
    // 整格显不显示归调用方（这一页没排满、或者这张正被拖着），组件不替它决定。
    if (card === null) return
    card.scale.set(this.cardScale)
    // 卡的原点在**底边中点**（见 CardSprite 的坐标约定）。
    card.position.set(this.boxWidth / 2, CARD_HEIGHT * this.cardScale)
    this.slot.addChild(card)
  }

  /** 现在摆着的是哪张卡。拖拽要把它从格子里拎出来。 */
  get shown(): CardSprite | null {
    return this.card
  }

  /**
   * 这张牌在当前牌组里带了几份。0 就不显示角标。
   *
   * 带满份数时整张压暗一档——那是「这一副带够了」，比灰卡（`setBlocked`）浅，
   * 因为换一副牌组它还能选。
   */
  setCopies(count: number, atMax: boolean): void {
    if (count !== this.copies) {
      this.copies = count
      for (const child of this.marks.removeChildren()) child.destroy({ children: true })
      if (count > 0) {
        const badge = new Badge({ variant: 'D', text: `×${count}`, tone: 'amber' }, this.deps)
        badge.position.set(BADGE_INSET, BADGE_INSET)
        this.marks.addChild(badge)
      }
    }
    this.paintVeil(atMax)
  }

  /**
   * 这张牌根本选不了（「即将上线」「暂未接入」），正中压一块牌子说明原因。
   * `null` 就是能选。
   */
  setBlocked(reason: string | null): void {
    if (reason === this.blocked) return
    this.blocked = reason
    for (const child of this.blockedSlot.removeChildren()) child.destroy({ children: true })
    this.add.visible = reason === null
    if (reason !== null) {
      const badge = new Badge({ variant: 'D', text: reason, tone: 'amber' }, this.deps)
      badge.position.set(
        (this.boxWidth - badge.boxWidth) / 2,
        (this.boxHeight - badge.boxHeight) / 2,
      )
      this.blockedSlot.addChild(badge)
    }
    this.paintVeil(false)
  }

  /** 「＋」现在灰不灰（牌组满了、同名带够了都算）。 */
  setAddDisabled(disabled: boolean): void {
    this.add.setDisabled(disabled)
  }

  /**
   * 压暗那一层。
   *
   * 旧版用的是 CSS 滤镜（`grayscale` + `brightness`），而纪律 3.1 不许挂 Filter，
   * 所以改成盖一层半透明的深色——目的一样：一眼看出这张现在选不了，
   * 而灰卡比「带满份数」再深一档。
   */
  private paintVeil(atMax: boolean): void {
    const alpha =
      this.blocked !== null
        ? 1 - tokens.opacity.deck.blockedCard
        : atMax
          ? 1 - tokens.opacity.deck.fullCard
          : 0
    this.veil.clear()
    if (alpha <= 0) return
    this.veil
      .rect(0, 0, this.boxWidth, this.boxHeight)
      .fill({ color: tokens.color.deck.blockedBase, alpha })
  }

  private place(): void {
    this.add.position.set(this.boxWidth - this.add.boxWidth - ADD.inset, ADD.inset)
    if (this.card !== null) {
      this.card.scale.set(this.cardScale)
      this.card.position.set(this.boxWidth / 2, CARD_HEIGHT * this.cardScale)
    }
    this.paintVeil(false)
  }
}
