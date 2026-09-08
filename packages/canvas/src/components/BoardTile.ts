/**
 * 战场上的一个格子：一张缩小的卡，加一列状态角标（需求单徽章 D），
 * 外加选目标时那圈会呼吸的橙色描边（弹窗 G 的一部分）。
 *
 * 卡由调用方建、也由调用方销毁——canvas 不管资源从哪来（同 PlayerPanel 的英雄牌）。
 * 格子只负责把它缩到战场尺寸、摆好角标、按状态改描边。
 *
 * 「缩到战场尺寸」写的是卡自己的 scale，不是另画一套小卡面：卡面排版是照 150×225
 * 写死的（见 CardSprite 的坐标约定），整张缩下去字和插画一起变小，比例才对得上。
 *
 * 橙圈是一圈 Graphics 描边，不是滤镜（3.1）。它画在卡的**外面**一圈：
 * 描在卡身上会被卡面盖住一半，而这一圈的用处正是「隔着别的卡也认得出这张能打」。
 * 呼吸补间只改 alpha 和 scale，符合 3.10。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Badge, type BadgeTone } from './Badge'
import type { CardSprite } from './CardSprite'

/** 角标之间的行距，以及整列离卡右上角多远。抄旧样式 `.battle__tile-marks` 的 gap 4 / inset 4。 */
const MARK_GAP = 4
const MARK_INSET = 4
/** 橙圈离卡边缘多远、画多粗、圆角比卡角大多少。抄 `.battle__tile-target-ring`。 */
const RING_SPREAD = 4
const RING_WIDTH = 2
/** 呼吸一趟多久（秒），以及两端的透明度和缩放。抄 MatchStage.tsx:1697-1709。 */
const PULSE_DUR = 0.7
const PULSE_ALPHA = { from: 0.35, to: 1 }
const PULSE_SCALE = { from: 0.98, to: 1.03 }

/** 一枚角标：印什么字、算哪一档配色。文案表跟着引擎的状态走，归场景查，不在这里。 */
export interface TileMark {
  text: string
  tone: BadgeTone
}

export interface BoardTileDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export class BoardTile extends Container {
  readonly instanceId: string
  /** 这个格子占多大。整排按它排位，落点动画也按它算尺寸。 */
  readonly boxWidth = tokens.size.card.tileWidth
  readonly boxHeight = tokens.size.card.tileHeight

  private readonly deps: BoardTileDeps
  /** 卡和角标都挂在这一层。放大查看借走卡时整层藏起来，格子仍占位（见 setHeld）。 */
  private readonly body = new Container()
  private readonly marks = new Container()
  private readonly ring: Graphics
  private card: CardSprite

  constructor(instanceId: string, card: CardSprite, deps: BoardTileDeps) {
    super()
    this.instanceId = instanceId
    this.deps = deps
    this.label = `tile:${instanceId}`
    // 原点在格子中心：整排排位、飞行落点、特效落点用的都是中心，摆哪儿都不用再换算。
    this.ring = this.buildRing()
    this.card = card
    this.adopt(card)
    this.addChild(this.ring, this.body)
    this.body.addChild(this.marks)
    this.ring.visible = false
  }

  /** 换一张卡（进化、主动英雄技能换卡）。旧的还给调用方处理。 */
  swapCard(card: CardSprite): CardSprite {
    const previous = this.card
    this.body.removeChild(previous)
    this.card = card
    this.adopt(card)
    return previous
  }

  /** 现在摆着的那张卡。特效要对着它做变换。 */
  get sprite(): CardSprite {
    return this.card
  }

  /**
   * 这张卡此刻由展示层代管（正被放大查看，或者对手打出的牌还停在展示位）：
   * 整层不可见但**格子还占着位置**——不然同一行剩下的卡会当场往中间挤一下，看完飞回来又挤回去。
   */
  setHeld(held: boolean): void {
    this.body.visible = !held
  }

  /** 挂哪几枚角标。传空数组就清干净。数量一变就整列重建（一轮里只发生几次）。 */
  setMarks(marks: readonly TileMark[]): void {
    for (const child of this.marks.removeChildren()) child.destroy({ children: true })
    let y = -this.boxHeight / 2 + MARK_INSET
    for (const mark of marks) {
      // 字面量 'D' 就是 BADGE_TILE_MARK（卡角状态角标），写字面量的理由同 BoardGrid。
      const badge = new Badge({ variant: 'D', text: mark.text, tone: mark.tone }, this.deps)
      badge.position.set(this.boxWidth / 2 - MARK_INSET - badge.boxWidth, y)
      this.marks.addChild(badge)
      y += badge.boxHeight + MARK_GAP
    }
  }

  /**
   * 这张卡是不是当前的合法目标。开着的时候橙圈一直呼吸，关掉就停。
   *
   * 停的时候要把补间也停掉：`repeat: -1` 的补间不会自己结束，留着帧循环就永远认为
   * 「还有东西在动」，停不下来（3.6）。
   */
  setTargetable(on: boolean): void {
    if (on === this.ring.visible) return
    this.ring.visible = on
    if (!on) {
      this.deps.animator.killTweensOf(this.ring)
      this.deps.animator.killTweensOf(this.ring.scale)
      return
    }
    this.ring.alpha = PULSE_ALPHA.from
    this.ring.scale.set(PULSE_SCALE.from)
    const pulse = { duration: PULSE_DUR, repeat: -1, yoyo: true, ease: 'sine.inOut' } as const
    this.deps.animator.tween(this.ring, { alpha: PULSE_ALPHA.to, ...pulse })
    this.deps.animator.tween(this.ring.scale, {
      x: PULSE_SCALE.to,
      y: PULSE_SCALE.to,
      ...pulse,
    })
  }

  /** 卡进来时把它缩到战场尺寸并对准格子中心。卡的原点在底边中点，所以要往下挪半格。 */
  private adopt(card: CardSprite): void {
    const scale = this.boxWidth / CARD_WIDTH
    card.scale.set(scale)
    card.position.set(0, this.boxHeight / 2)
    this.body.addChildAt(card, 0)
  }

  /** 橙圈：贴着卡轮廓往外扩一圈的圆角描边。 */
  private buildRing(): Graphics {
    const scale = this.boxWidth / CARD_WIDTH
    const w = this.boxWidth + RING_SPREAD * 2
    const h = CARD_HEIGHT * scale + RING_SPREAD * 2
    const ring = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, CARD_RADIUS * scale + RING_SPREAD)
      .stroke({ width: RING_WIDTH, color: tokens.color.accent.skill })
    ring.eventMode = 'none'
    return ring
  }
}
