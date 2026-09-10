/**
 * 侧栏里的一块玩家面板：一圈雕花框（需求单边框 A）里摆一张英雄牌，
 * 牌下压一块铭牌（徽章 C）写名字，右缘可以挂一条 Token 细条（面板 E），
 * 我方那块还能在英雄牌脚上挂一颗「发动技能」的小匾额钮。
 *
 * 组件是哑的：`setName` / `setHero` / `setScore` / `setTokens` / `setHeroSkill`
 * 由场景在收到新视图时调，它自己不认识引擎。尺寸由调用方给（`resize`）——
 * 桌面和手机是两档并列的版式，侧栏宽度不同，这块面板跟着变。
 *
 * 和旧版的三处出入，都是有意的：
 * 1. 旧版这块面板上**不画**名字和比分（比分在顶栏，谁是谁靠上下位置分），这里两样都能画。
 *    多出来的两个方法是给两档版式留的余地：手机档没有那条横贯的顶栏，比分只能落在这儿。
 *    不设就不画（`setName(null)` / `setScore(null)`），桌面档照旧和旧版一样干净。
 * 2. 旧版的 Token 细条贴在**战场右缘**、独立于侧栏，这里挂在面板上。合在一起是因为
 *    「谁还剩几点」本来就是这块面板要回答的事，而且合了之后场景摆版式只用摆一样东西。
 *    细条有固定高度（令牌 `size.rail.height` 470），装不进面板时整条等比缩小——
 *    缩的是 Container 的 scale，属于 transform，不重画里面任何一颗星。
 * 3. 旧版的「发动技能」是压在卡面左下角的一颗药丸小钮，这里换成居中的纸白匾额钮
 *    （需求单里没有「英雄技能钮」这个变体，按钮 B 的小尺寸档最接近）。挪到正中是因为
 *    左下角那个位置在旧版是给卡堆和角标分的，而新版这块面板上没有那些东西要避让。
 *
 * 卡堆（旧版压在英雄牌一角的那摞牌背）不在这里：它是发牌动画的起飞点，
 * 归场景摆（`scenes/duelLayout.ts` 里已经有 `deck` 那一项）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Badge } from './Badge'
import { Label } from './Label'
import { OrnateFrame } from './OrnateFrame'
import { PLAQUE_PAPER, PlaqueButton, type PlaqueButtonDeps } from './PlaqueButton'
import { TokenRail } from './TokenRail'

/**
 * 这块面板自己的字号（px）。按 design 的 README「组件私有字号」那条留在组件里。
 * 比分那一档和顶栏的比分数字同大小——两处说的是同一件事，换版式时只会用其中一处。
 */
const TYPE = { score: { fontSize: 30, letterSpacing: 0 } } as const

/** 英雄牌四周离雕花框留多宽。旧版是面板内边距 18，这里连框宽一起算。 */
const CARD_INSET = 22
/**
 * 卡面上那条铭牌离卡底多远（卡面基准尺寸下的像素）。
 * 和 CardSprite 摆自己那条铭牌用的是同一个数（那边写的是 `-6 - 高度/2`），
 * 这块面板的铭牌要正好盖住它，两处必须一致。
 */
const NAMEPLATE_PAD = 6
/** 细条离面板右缘多远。贴着框内侧摆。 */
const RAIL_INSET = 6

/**
 * 「发动技能」那颗钮相对英雄牌缩到多小。
 *
 * 按旧版那颗药丸钮的比例取的：它压在卡面左下角，最宽不超过卡宽的 62%
 *（styles.css 的 .battle__hero-skill max-width）。匾额钮的 play 档是 132 宽，
 * 卡宽 150，所以 0.7 倍之后正好落在那个宽度上。
 */
const SKILL_BUTTON_SCALE = 0.7
/** 钮的中心离英雄牌底边多高（卡面基准尺寸下的像素）。压在卡脚那条铭牌上方一点。 */
const SKILL_BUTTON_BOTTOM = 42

export interface PlayerPanelDeps extends PlaqueButtonDeps {
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

/** 「发动技能」那颗钮要什么。传 null 给 `setHeroSkill` 就是不挂这颗钮。 */
export interface HeroSkillButton {
  /** 匾上印的字。旧版印的是技能名（「精准检索」），不是「发动」——玩家得知道要发动什么。 */
  caption: string
  onActivate(): void
}

export class PlayerPanel extends Container {
  private readonly deps: PlayerPanelDeps
  private readonly frame: OrnateFrame
  /** 英雄牌挂在这一层。放大查看把牌借走时，这一层留着占位（见 setHeroHeld）。 */
  private readonly heroSlot = new Container()
  private readonly plateSlot = new Container()
  private readonly scoreSlot = new Container()
  private readonly skillSlot = new Container()
  private readonly rail: TokenRail | null

  private boxWidth: number
  private boxHeight: number
  private hero: Container | null = null
  private heroName: string | null = null
  private score: number | null = null
  private skill: PlaqueButton | null = null
  /** 钮上现在印的是哪一句。没变就不重建——重建一次要新烤一张文字纹理。 */
  private skillCaption: string | null = null

  constructor(options: PlayerPanelOptions, deps: PlayerPanelDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.label = 'player-panel'

    this.frame = new OrnateFrame(options.width, options.height, deps)
    this.rail = options.tokens === true ? new TokenRail(deps) : null
    // 技能钮排在雕花框后面：框是画在最上层的，钮要压在它上面才点得着。
    this.addChild(this.heroSlot, this.plateSlot, this.scoreSlot, this.frame, this.skillSlot)
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
   *
   * 收的是 `Container` 而不是 `CardSprite`：英雄原画本来就是一整张画好的卡面
   *（名字和英文名都印在图里），场景递过来的是一张按卡面基准尺寸摆好的精灵，
   * 而不是那种自己画铭牌和费用圆章的 `CardSprite`——英雄没有费用，
   * 印一枚「0」的圆章是错的。目录页那几条仍然递 `CardSprite`（它也是 Container），
   * 因为那边只是要一张看着像牌的东西。
   *
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
   * 用 visible 而不是把卡摘掉，是为了飞回来时位置还在（同旧版 `.battle__hero--held`）。
   */
  setHeroHeld(held: boolean): void {
    this.heroSlot.visible = !held
  }

  /** 英雄牌的中心（这块面板自己的坐标）。放大查看要拿它当起飞点和落点。 */
  heroCenter(): { x: number; y: number } {
    return { x: this.boxWidth / 2, y: this.heroSlot.y - (CARD_HEIGHT * this.heroScale()) / 2 }
  }

  /**
   * 铭牌上那行名字。写的是**玩家**的名字，不是卡名。传 null 就不画。
   *
   * 铭牌自己带 6% 的透明度（见 fx/badgeShapes.ts 的 drawNameplateBand），
   * 直接压在英雄牌那条铭牌上会透出底下的卡名，两行字叠在一起谁也读不出来。
   * 所以先垫一层不透明的纸底再摆铭牌——垫的这块和铭牌一样大，看不出多了一层。
   */
  setName(name: string | null): void {
    if (this.heroName === name) return
    this.heroName = name
    for (const child of this.plateSlot.removeChildren()) child.destroy({ children: true })
    if (name !== null) {
      // 字面量 'C' 就是 BADGE_NAMEPLATE（卡面铭牌），写字面量的理由同 BoardGrid。
      const badge = new Badge({ variant: 'C', name }, this.deps)
      const backing = new Graphics()
        .rect(0, 0, badge.boxWidth, badge.boxHeight)
        .fill({ color: tokens.color.battle.paper })
      const plate = new Container()
      plate.addChild(backing, badge)
      this.plateSlot.addChild(plate)
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
   * 挂 / 摘「发动技能」那颗钮。
   *
   * 传 null 的三种情况：这是对方那块面板、这一方的英雄是被动技能（或还没实装）、
   * 技能这一局已经用过了。用过之后**摘掉**而不是永久置灰，是抄旧版的：
   * 灰着的钮会让人一直去点它，摘掉才说得清「这一局没有了」。
   *
   * 钮由面板自己建自己收（和英雄牌相反）：它是面板的一部分，不是外面借来摆的资源。
   */
  setHeroSkill(skill: HeroSkillButton | null): void {
    const caption = skill?.caption ?? null
    // 没变就不动：applyView 每收到一条指令都会调一次，重建一次要新烤一张文字纹理。
    if (caption === this.skillCaption) return
    this.skillCaption = caption
    for (const child of this.skillSlot.removeChildren()) child.destroy({ children: true })
    this.skill = null
    if (skill !== null) {
      this.skill = new PlaqueButton(
        {
          variant: PLAQUE_PAPER,
          caption: skill.caption,
          // 需求单里没有「英雄技能钮」这个变体，按纸白匾额（按钮 B）的小尺寸档做：
          // 它压在深色的英雄原画上，纸白才读得出来，而墨蓝会糊进卡面里。
          size: 'play',
          onActivate: skill.onActivate,
        },
        this.deps,
      )
      this.skillSlot.addChild(this.skill)
    }
    this.layout()
  }

  /** 钮点不点得动。没挂钮时什么都不做。 */
  setHeroSkillDisabled(disabled: boolean): void {
    this.skill?.setDisabled(disabled)
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

    /*
     * 铭牌盖在英雄牌自己那条铭牌上，位置和大小都跟着卡缩放走。
     *
     * 盖住而不是另找地方摆：卡面下部本来就有一条铭牌（写的是卡名），这一块要写的是
     * **玩家**的名字。两条并排会让人不知道该读哪一条，正好盖上去换掉它。
     * 铭牌本身和卡面上那条是同一份形状（fx/badgeShapes.ts 的 drawNameplateBand），
     * 所以只要跟着卡一起缩、再让开同样的下边距，两条就严丝合缝地对上。
     */
    const plate = this.plateSlot.children[0]
    const badge = plate?.children[1] as Badge | undefined
    if (plate !== undefined && badge !== undefined) {
      plate.scale.set(scale)
      plate.position.set(
        cardCenterX - (badge.boxWidth / 2) * scale,
        cardBottom - (NAMEPLATE_PAD + badge.boxHeight) * scale,
      )
    }

    const label = this.scoreSlot.children[0]
    if (label !== undefined) label.position.set(cardCenterX, CARD_INSET)

    if (this.skill !== null) {
      // 钮跟着卡一起缩，位置也按卡面基准尺寸算，换版式时和卡的相对关系不变。
      const buttonScale = scale * SKILL_BUTTON_SCALE
      this.skill.scale.set(buttonScale)
      this.skill.position.set(
        cardCenterX - (this.skill.boxWidth * buttonScale) / 2,
        cardBottom - SKILL_BUTTON_BOTTOM * scale - this.skill.boxHeight * buttonScale,
      )
    }

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
