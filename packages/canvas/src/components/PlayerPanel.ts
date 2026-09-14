/**
 * 一块玩家面板：一圈素方块里摆一张英雄牌，顶边压一格名字，角上压一摞牌库。
 * 我方那块还能在英雄牌脚上挂一颗「发动技能」的方块钮，手机档另外在右缘挂一条 Token 细条。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：雕花框、纸底铭牌、匾额钮
 * 全换成一圈描边。英雄牌**不动**——它是卡牌，卡面归第 4 步之三（D2b）管。
 *
 * 组件是哑的：`setName` / `setHero` / `setScore` / `setTokens` / `setHeroSkill` /
 * `setDeckCount` 由场景在收到新视图时调，它自己不认识引擎。尺寸由调用方给（`resize`）。
 *
 * ## 名字为什么压在卡上
 *
 * 黑客松版这块面板上英雄牌是**填满整块**的（桌面档 249×373.5），名字和比分压根没有。
 * 这一版要写名字，但又不能为它单开一行——开了英雄牌就得缩一圈，和那一版的数对不上。
 * 所以名字那一格盖在卡的顶边上，同那一版把铭牌盖在卡面铭牌上的做法。
 *
 * ## 牌库那一摞
 *
 * 三层错开的方块加一个剩余张数，压在英雄牌角上：我方在右下、对方在右上，上下镜像——
 * 两块面板本来就是照战场那条中线对称摆的，「自己的牌从自己那头飞出来」才对得上。
 * 最上面那层同时是**发牌飞行的起点**，版式那边按同一个 `deckPileRectOf` 算起飞姿态
 *（见 layout/panelGeometry.ts），两处必然落在同一个矩形上。
 */

import { Container } from 'pixi.js'
import { CARD_WIDTH } from '../layout/fanMath'
import { deckPileRectOf, heroCardRectOf } from '../layout/panelGeometry'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'
import { TokenRail } from './TokenRail'

/** 名字那一格多高。压在卡顶边上，所以不占面板的高度预算。 */
const NAME_HEIGHT = 24
/** Token 细条离面板右缘多远（只有手机档那一侧挂它）。 */
const RAIL_INSET = 6
/** 「发动技能」那颗钮相对英雄牌多宽、多高、离卡底多远（都按卡面基准尺寸算，跟着卡一起缩）。 */
const SKILL_BUTTON = { widthRatio: 0.62, height: 40, bottom: 42 } as const
/** 牌库那一摞底下两层各错开多少（像素，跟着堆一起缩之前的量）。 */
const DECK_OFFSETS = [5, 2.5] as const
/** 牌堆空了时那一圈「加粗」的描边往里让多少：两条平行的 1px 线看着就是 2px。 */
const EMPTY_RING_INSET = 2

export interface PlayerPanelDeps extends BoxDeps {
  animator: Animator
}

export interface PlayerPanelOptions {
  width: number
  height: number
  /** 挂不挂 Token 细条。桌面档不挂——那一档细条贴在舞台右缘自己站着（见版式的 tokenRail）。 */
  tokens?: boolean
  /**
   * 英雄牌四周留多宽。
   *
   * 桌面档传 0：那一档面板 266×373.5，英雄牌按 2:3 填满正好是黑客松版的 249×373.5。
   * 手机档那一行只有 96 高，卡贴着框边会和名字那一格糊在一起，所以留一圈。
   */
  cardInset?: number
  /** 牌库那一摞压在英雄牌哪个角上。不给就不画（手机档那一行摆不下）。 */
  deckSide?: 'top' | 'bottom'
}

/** 「发动技能」那颗钮要什么。传 null 给 `setHeroSkill` 就是不挂这颗钮。 */
export interface HeroSkillButton {
  /** 钮上印的字。旧版印的是技能名（「精准检索」），不是「发动」——玩家得知道要发动什么。 */
  caption: string
  onActivate(): void
}

export class PlayerPanel extends Container {
  private readonly deps: PlayerPanelDeps
  private readonly frame: Box
  /** 英雄牌挂在这一层。放大查看把牌借走时，这一层留着占位（见 setHeroHeld）。 */
  private readonly heroSlot = new Container()
  private readonly nameBox: Box
  private readonly deckSlot = new Container()
  private readonly skillSlot = new Container()
  private readonly rail: TokenRail | null
  private readonly cardInset: number
  private readonly deckSide: 'top' | 'bottom' | null

  private boxWidth: number
  private boxHeight: number
  private hero: Container | null = null
  private heroName: string | null = null
  private score: number | null = null
  private skill: Box | null = null
  /** 钮上现在印的是哪一句。没变就不重建——重建一次要新烤一张文字纹理。 */
  private skillCaption: string | null = null
  private deckCount: number | null = null

  constructor(options: PlayerPanelOptions, deps: PlayerPanelDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.cardInset = options.cardInset ?? 0
    this.deckSide = options.deckSide ?? null
    this.label = 'player-panel'

    this.frame = new Box({ width: options.width, height: options.height }, deps)
    this.nameBox = new Box({ width: 1, height: NAME_HEIGHT, size: 'small' }, deps)
    this.rail = options.tokens === true ? new TokenRail(deps) : null
    // 名字、牌堆和技能钮都排在框后面：框画在最上层，压在它上面才看得见、点得着。
    this.addChild(this.heroSlot, this.frame, this.nameBox, this.deckSlot, this.skillSlot)
    if (this.rail !== null) this.addChild(this.rail)
    this.layout()
  }

  /** 改大小。里面的东西重新摆位，一个对象都不重建。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.frame.setSize(width, height)
    this.layout()
  }

  /**
   * 换英雄牌。传 null 摘掉（还没选英雄）。
   *
   * 收的是 `Container` 而不是 `CardSprite`：英雄原画本来就是一整张画好的卡面
   *（名字和英文名都印在图里），场景递过来的是一张按卡面基准尺寸摆好的精灵。
   * 卡由调用方建也由调用方销毁——canvas 不管资源从哪来，这里只借来摆。
   */
  setHero(card: Container | null): void {
    this.heroSlot.removeChildren()
    this.hero = card
    if (card !== null) this.heroSlot.addChild(card)
    this.layout()
  }

  /** 英雄位上摆着东西了没有。场景靠它避免每收到一条指令就把原画重建一遍。 */
  hasHero(): boolean {
    return this.hero !== null
  }

  /**
   * 这张英雄牌此刻被放大查看借走了：原位让出来但**格子还占着**。
   * 用 visible 而不是把卡摘掉，是为了飞回来时位置还在。
   */
  setHeroHeld(held: boolean): void {
    this.heroSlot.visible = !held
  }

  /** 英雄牌的中心（这块面板自己的坐标）。放大查看要拿它当起飞点和落点。 */
  heroCenter(): { x: number; y: number } {
    const rect = this.heroRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }

  /** 名字那一格上写的是**玩家**的名字，不是卡名。传 null 就不写。 */
  setName(name: string | null): void {
    if (this.heroName === name) return
    this.heroName = name
    this.nameBox.setLabel(this.nameText())
  }

  /** 这一侧的比分，和名字写在同一格里。传 null 就不写。 */
  setScore(score: number | null): void {
    if (this.score === score) return
    this.score = score
    this.nameBox.setLabel(this.nameText())
  }

  /** 剩余 Token。没挂细条的那一侧调它没有效果（桌面档的细条在版式里另摆）。 */
  setTokens(current: number, max: number): void {
    this.rail?.setTokens(current, max)
  }

  /** 牌库还剩几张。传 null（或这一侧不画牌堆）就什么都不做。 */
  setDeckCount(count: number | null): void {
    if (this.deckCount === count) return
    this.deckCount = count
    this.rebuildDeck()
  }

  /**
   * 挂 / 摘「发动技能」那颗钮。
   *
   * 传 null 的三种情况：这是对方那块面板、这一方的英雄是被动技能（或还没实装）、
   * 技能这一局已经用过了。用过之后**摘掉**而不是永久置灰，是抄旧版的：
   * 灰着的钮会让人一直去点它，摘掉才说得清「这一局没有了」。
   */
  setHeroSkill(skill: HeroSkillButton | null): void {
    const caption = skill?.caption ?? null
    // 没变就不动：applyView 每收到一条指令都会调一次，重建一次要新烤一张文字纹理。
    if (caption === this.skillCaption) return
    this.skillCaption = caption
    for (const child of this.skillSlot.removeChildren()) child.destroy({ children: true })
    this.skill = null
    if (skill !== null) {
      const button = new Box(
        { width: 1, height: 1, label: skill.caption, size: 'small' },
        this.deps,
      )
      /*
       * 在场景树上给它留个名字，命名跟卡（`card:`）和「结束出牌」（`button:end-play`）一路。
       * 真浏览器的交互回归靠它找到「按哪儿」（bench 的 src/page/hitPoints.ts）。
       * 名字在这里给而不是由装配处给：这颗钮是面板自己建自己收的，外面根本拿不到它。
       */
      button.label = 'button:hero-skill'
      button.onPress(skill.onActivate)
      this.skill = button
      this.skillSlot.addChild(button)
    }
    this.layout()
  }

  /** 钮点不点得动。没挂钮时什么都不做。 */
  setHeroSkillDisabled(disabled: boolean): void {
    this.skill?.setDisabled(disabled)
  }

  /** 名字那一格印什么：名字加比分，两样都没有就空着。 */
  private nameText(): string {
    const parts: string[] = []
    if (this.heroName !== null) parts.push(this.heroName)
    if (this.score !== null) parts.push(String(this.score))
    return parts.join(' ')
  }

  /** 英雄牌在这块面板里占的矩形。公式和版式那边共用一份（见 layout/types.ts）。 */
  private heroRect(): { x: number; y: number; width: number; height: number } {
    const railWidth = this.rail === null ? 0 : this.rail.boxWidth + RAIL_INSET
    return heroCardRectOf(
      { x: 0, y: 0, width: this.boxWidth - railWidth, height: this.boxHeight },
      this.cardInset,
    )
  }

  /** 把英雄牌、名字、牌堆、技能钮和细条摆好。全是写 position 和 scale，不重建任何对象。 */
  private layout(): void {
    const rect = this.heroRect()
    const scale = rect.width / CARD_WIDTH
    // 卡的原点在底边中点（见 CardSprite 的坐标约定），所以这一层摆的是卡脚的位置。
    this.heroSlot.position.set(rect.x + rect.width / 2, rect.y + rect.height)
    this.hero?.scale.set(scale)

    this.nameBox.setSize(Math.max(1, rect.width), NAME_HEIGHT)
    this.nameBox.position.set(rect.x, rect.y)

    this.rebuildDeck()

    if (this.skill !== null) {
      const width = rect.width * SKILL_BUTTON.widthRatio
      const height = SKILL_BUTTON.height * scale
      this.skill.setSize(width, height)
      this.skill.position.set(
        rect.x + (rect.width - width) / 2,
        rect.y + rect.height - SKILL_BUTTON.bottom * scale - height,
      )
    }

    if (this.rail !== null) {
      // 细条比面板高就整条缩进来，缩的是 transform，里面的格子一个都不重画。
      const fit = Math.min(1, this.boxHeight / this.rail.boxHeight)
      this.rail.scale.set(fit)
      this.rail.position.set(
        this.boxWidth - RAIL_INSET - this.rail.boxWidth * fit,
        (this.boxHeight - this.rail.boxHeight * fit) / 2,
      )
    }
  }

  /**
   * 重画牌库那一摞。张数一变就整块重建——它一轮只变几次，不在动画期间。
   *
   * 空了的时候在最上面那层里再套一圈：素方块只有 1px 一档描边，两条平行的线看着就是加粗，
   * 而牌堆空了之后每轮补牌都是白抽一次，这件事画面上没有别的地方说得出来。
   */
  private rebuildDeck(): void {
    for (const child of this.deckSlot.removeChildren()) child.destroy({ children: true })
    const side = this.deckSide
    const count = this.deckCount
    if (side === null || count === null) return
    const pile = deckPileRectOf(this.heroRect(), side)
    for (const offset of DECK_OFFSETS) {
      const under = new Box({ width: pile.width, height: pile.height }, this.deps)
      under.position.set(pile.x - offset, pile.y - offset)
      this.deckSlot.addChild(under)
    }
    const top = new Box(
      { width: pile.width, height: pile.height, label: String(count), size: 'small' },
      this.deps,
    )
    top.position.set(pile.x, pile.y)
    this.deckSlot.addChild(top)
    if (count === 0) {
      const ring = new Box(
        {
          width: pile.width - EMPTY_RING_INSET * 2,
          height: pile.height - EMPTY_RING_INSET * 2,
        },
        this.deps,
      )
      ring.position.set(pile.x + EMPTY_RING_INSET, pile.y + EMPTY_RING_INSET)
      this.deckSlot.addChild(ring)
    }
  }
}
