/**
 * 卡池里的一格：一张卡，加上「带了几份」的角标、一颗「＋」，以及选不了时正中那块牌子。
 *
 * **不导出**（同 BoardTile、SettleRow 那几个）：它只对构筑页的卡池负责，
 * 拆成文件是被 400 行那条上限逼的，不是多了一个可以单独用的组件。
 *
 * 格子是**长住**的：窗口里同时摆得下几格就建几格，滚动时格子原地回收、只换里面那张卡
 *（`setCard`）和它的落点，格子本身、「＋」和角标一次都不重建——滚动是这一页最频繁的动作，
 * 随建随销的话每滚一行就是一屏的对象分配（6.9 的「稳态每帧堆分配」量的正是这个）。
 *
 * 正式版简化第 4 步之四之后，格子上的界面件全是素方块（见 Box.ts），三种状态靠
 * **tint 加描边**表达，不挂 Filter（纪律 3.1）：
 *   hover   常驻一层描边，只切 alpha（同黑客松 `.deck-pool-card__glow` 的做法）
 *   选中    常驻一层内描边，只切 alpha
 *   满 / 灰 卡整张压暗一档 / 两档（`CardSprite.setDim`）
 */

import { Container, Graphics, Rectangle } from 'pixi.js'
import { CARD_HEIGHT } from '../layout/fanMath'
import { BOX_LINE, Box, type BoxDeps } from './Box'
import type { CardSprite } from './CardSprite'

/**
 * 「＋」那颗方块的边长，以及它离格子**右上角**多远。
 *
 * 摆右上角而不是黑客松的右下角：卡面底部有一条印着模型名的铭牌，钮压上去正好盖住名字。
 * 左上角让给「带了几份」的角标。
 */
const ADD = { size: 26, inset: 4 }
/** 角标离格子左上角多远，以及它多大。 */
const BADGE = { inset: 4, width: 34, height: 20 }
/** 选不了那块牌子多高，左右各留多宽。 */
const BLOCKED = { height: 24, padX: 12 }

/** 带满份数时整张卡压暗到哪一档，以及根本选不了时那一档。灰阶，不换颜色（同 Box 的规矩）。 */
const DIM_FULL = 0xb0b0b0
const DIM_BLOCKED = 0x808080

export type PoolCellDeps = BoxDeps

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
  /**
   * 这一格此刻摆的是筛完之后卡池里的第几张。
   *
   * 滚动时格子原地回收，所以格子的序号和卡池的序号**不是一回事**：
   * 「＋」和拖拽都要按这个字段回问是哪张牌。由 render 每一轮写进来，没摆牌时是 -1。
   */
  poolIndex = -1

  private readonly deps: PoolCellDeps
  private readonly slot = new Container()
  private readonly hoverRing = new Graphics()
  private readonly pickedRing = new Graphics()
  private readonly add: Box
  private badge: Box | null = null
  private blockedPlate: Box | null = null
  private boxWidth: number
  private boxHeight: number
  private cardScale: number
  private card: CardSprite | null = null
  private copies = 0
  private blocked: string | null = null
  private atMaxCopies = false

  constructor(options: PoolCellOptions, deps: PoolCellDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.cardScale = options.cardScale
    this.add = new Box({ width: ADD.size, height: ADD.size, label: '＋' }, deps)
    this.add.onPress(() => options.onAdd?.())
    // 两圈描边都只是画面，吃了指针事件卡面就点不着了。
    this.hoverRing.eventMode = 'none'
    this.pickedRing.eventMode = 'none'
    this.hoverRing.alpha = 0
    this.pickedRing.alpha = 0
    this.addChild(this.slot, this.hoverRing, this.pickedRing, this.add)
    /*
     * 整格吃指针事件，命中区显式给成格子那块矩形：
     * hover 高亮和跟指针倾斜都靠它，而按包围盒算的话卡在倾斜期间是梯形、每帧都在变。
     */
    this.eventMode = 'static'
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
   * 摆一张卡进来（`null` 就是这一格这一轮没有牌）。
   *
   * 卡由**调用方建、调用方回收**（见 scenes/deck/cards.ts 的回收池）：
   * 它随时可能被拖出去、飞回来，格子只是借来摆一会儿。
   */
  setCard(card: CardSprite | null): void {
    // 同一张、而且还挂在这一格上：什么都不用做。滚动之外的绝大多数重排走的都是这条。
    if (card === this.card && (card === null || card.parent === this.slot)) return
    this.slot.removeChildren()
    this.card = card
    // 整格显不显示归调用方（这一轮没排满、或者这张正被拖着），组件不替它决定。
    if (card === null) return
    card.scale.set(this.cardScale)
    // 卡的原点在**底边中点**（见 CardSprite 的坐标约定）。
    card.position.set(this.boxWidth / 2, CARD_HEIGHT * this.cardScale)
    this.slot.addChild(card)
    this.paintDim()
  }

  /** 现在摆着的是哪张卡。拖拽和倾斜跟随要把它拎出来。 */
  get shown(): CardSprite | null {
    return this.card
  }

  /** 指针停在这一格上没有。只切一层常驻描边的 alpha，一帧卡面都不用重画。 */
  setHovered(hovered: boolean): void {
    this.hoverRing.alpha = hovered ? 1 : 0
  }

  /**
   * 这张牌在当前牌组里带了几份。0 就不显示角标。
   *
   * 带满份数时整张压暗一档——那是「这一副带够了」，比灰卡（`setBlocked`）浅，
   * 因为换一副牌组它还能选。
   */
  setCopies(count: number, atMax: boolean): void {
    this.atMaxCopies = atMax
    if (count !== this.copies) {
      this.copies = count
      if (this.badge !== null) {
        this.removeChild(this.badge)
        this.badge.destroy({ children: true })
        this.badge = null
      }
      if (count > 0) {
        const badge = new Box(
          { width: BADGE.width, height: BADGE.height, label: `×${count}`, size: 'small' },
          this.deps,
        )
        badge.position.set(BADGE.inset, BADGE.inset)
        badge.eventMode = 'none'
        this.badge = badge
        this.addChild(badge)
      }
    }
    // 选进牌组了就亮一圈内描边：黑客松那边是金色双线，这一版只有描边可用。
    this.pickedRing.alpha = count > 0 ? 1 : 0
    this.paintDim()
  }

  /**
   * 这张牌根本选不了（「即将上线」「暂未接入」），正中压一块牌子说明原因。
   * `null` 就是能选。
   */
  setBlocked(reason: string | null): void {
    if (reason === this.blocked) return
    this.blocked = reason
    if (this.blockedPlate !== null) {
      this.removeChild(this.blockedPlate)
      this.blockedPlate.destroy({ children: true })
      this.blockedPlate = null
    }
    this.add.visible = reason === null
    if (reason !== null) {
      const width = reason.length * 14 + BLOCKED.padX * 2
      const plate = new Box({ width, height: BLOCKED.height, label: reason }, this.deps)
      plate.position.set((this.boxWidth - width) / 2, (this.boxHeight - BLOCKED.height) / 2)
      plate.eventMode = 'none'
      this.blockedPlate = plate
      this.addChild(plate)
    }
    this.paintDim()
  }

  /** 「＋」现在灰不灰（牌组满了、同名带够了都算）。 */
  setAddDisabled(disabled: boolean): void {
    this.add.setDisabled(disabled)
  }

  /**
   * 压暗那一档。
   *
   * 黑客松用的是 CSS 滤镜（`grayscale` + `brightness`），而纪律 3.1 不许挂 Filter，
   * 所以改成把整张卡的 tint 压下去（`CardSprite.setDim`）——目的一样：一眼看出这张现在选不了，
   * 而灰卡比「带满份数」再深一档。
   */
  private paintDim(): void {
    this.card?.setDim(this.blocked !== null ? DIM_BLOCKED : this.atMaxCopies ? DIM_FULL : 0xffffff)
  }

  private place(): void {
    this.hitArea = new Rectangle(0, 0, this.boxWidth, this.boxHeight)
    this.add.position.set(this.boxWidth - ADD.size - ADD.inset, ADD.inset)
    this.hoverRing
      .clear()
      .rect(-1.5, -1.5, this.boxWidth + 3, this.boxHeight + 3)
      .stroke({ width: 1, color: BOX_LINE })
    this.pickedRing
      .clear()
      .rect(3.5, 3.5, Math.max(1, this.boxWidth - 7), Math.max(1, this.boxHeight - 7))
      .stroke({ width: 1, color: BOX_LINE })
    if (this.blockedPlate !== null) {
      this.blockedPlate.position.set(
        (this.boxWidth - this.blockedPlate.boxWidth) / 2,
        (this.boxHeight - BLOCKED.height) / 2,
      )
    }
    if (this.card !== null) {
      this.card.scale.set(this.cardScale)
      this.card.position.set(this.boxWidth / 2, CARD_HEIGHT * this.cardScale)
    }
  }
}
