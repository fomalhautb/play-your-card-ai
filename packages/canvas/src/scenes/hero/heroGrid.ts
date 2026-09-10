/**
 * 选英雄页那两排卡：七张人物卡原画，加上悬停的上浮 / 放大 / 倾斜和「点击查看技能」。
 *
 * 摆的是**整张原画**而不是 `CardSprite`：名字、边框、装饰都画在图里了，
 * 再给它套一层铭牌和费用圆章是错的——英雄没有费用（同 duelContract 里
 * `CardTextures.heroes` 那条说明）。
 *
 * 还没实装的几位（`comingSoon`）照原位渲染，但压一层灰 tint、整张压暗，
 * 并盖一块「敬请期待」小牌（需求单徽章 I），指针交互整套都不挂。
 * 少渲染一张会让后面所有卡对错人，而且玩家会以为这游戏只有四位英雄。
 *
 * 倾斜自己写，不复用 `CardTilt`：那一套是给 `CardSprite` 的（它把角度换算成各层网格的
 * 四个角，做的是真透视）。这里是一张普通精灵，只能做仿射的错切——真透视要把整张原画
 * 也拆成网格，为一页静态卡阵不值当。所以这里的「倾斜」只是**绕中心转一点角度**，
 * 幅度按旧版的 `CARD_TILT_DEG = 8` 折算。
 */

import { tokens } from '@ai-duel/design'
import { Container, Rectangle, Sprite } from 'pixi.js'
import { Badge, type BadgeDeps } from '../../components/Badge'
import { BUBBLE_TIP, Bubble, type BubbleDeps } from '../../components/Bubble'
import type { Animator } from '../../runtime/animator'
import { killAndDestroy } from '../../runtime/dispose'
import type { HeroEntry } from './heroContract'
import type { HeroLayout, HeroRect } from './heroLayout'

/** 悬停时上浮多少（占卡高的比例）、放大到多少、多久。抄旧版 HeroScreen 的三个常量。 */
const HOVER_LIFT_RATIO = 0.02
const HOVER_SCALE = 1.035
const HOVER_DUR = 0.25
/** 悬停时整张卡转多少度。旧版是绕两轴各 8°，这里折成绕中心的一个小角度。 */
const HOVER_TILT_DEG = 1.6
/** 「敬请期待」那块小牌相对卡宽的比例，决定它跟着卡缩到多小。 */
const SOON_SCALE_BASE = 220

export type HeroGridDeps = BadgeDeps & BubbleDeps & { animator: Animator }

/** 一张卡在这一层里的东西。 */
interface HeroCard {
  /** 外层：版式给的落点写在它身上，悬停不碰它。 */
  slot: Container
  /** 内层：悬停的上浮、放大、转角都写在它身上，两边不抢同一个 transform。 */
  lift: Container
  rect: HeroRect
  soon: boolean
}

export class HeroGrid extends Container {
  private readonly deps: HeroGridDeps
  private readonly heroes: readonly HeroEntry[]
  private readonly cards: HeroCard[] = []
  private hovered: number | null = null
  private hint: Bubble | null = null
  private onOpen: ((hero: string) => void) | null = null

  constructor(heroes: readonly HeroEntry[], deps: HeroGridDeps) {
    super()
    this.deps = deps
    this.heroes = heroes
    this.label = 'hero-grid'
  }

  setOnOpen(callback: (hero: string) => void): void {
    this.onOpen = callback
  }

  /** 按一档版式重建整层。换版式时卡的尺寸全变了，重建比逐个改省事也更不容易漏。 */
  place(layout: HeroLayout): void {
    for (const child of this.removeChildren()) killAndDestroy(this.deps.animator, child)
    this.cards.length = 0
    this.hovered = null
    this.hint = null
    this.heroes.forEach((hero, index) => {
      const rect = layout.cards[index]
      if (rect === undefined) return
      this.cards.push(this.build(hero, rect, index))
    })
  }

  /** 把悬停摆到第 index 张（null 是不停）。目录页和真指针走的是同一条路。 */
  setHovered(index: number | null): void {
    if (index === this.hovered) return
    const before = this.hovered
    this.hovered = index
    if (before !== null) this.pose(before, false)
    if (index !== null) this.pose(index, true)
    this.refreshHint()
  }

  private build(hero: HeroEntry, rect: HeroRect, index: number): HeroCard {
    const slot = new Container()
    slot.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2)
    const lift = new Container()
    slot.addChild(lift)

    const art = new Sprite(hero.art)
    art.anchor.set(0.5)
    art.setSize(rect.width, rect.height)
    lift.addChild(art)

    const soon = hero.comingSoon === true
    if (soon) {
      /*
       * 不挂 Filter（3.1）：旧版那句 grayscale 滤镜换成一层灰 tint 加整张压暗。
       * 压暗写在**原画**上而不是外面那层：角标要留在这层里跟着卡一起缩放和上浮，
       * 但它是「这张还没做完」的说明，跟着一起变淡就没人看得见了。
       */
      art.tint = tokens.color.hero.soonTint
      art.alpha = tokens.opacity.hero.soonCard
      const badge = new Badge(
        // 写字面量而不是 BADGE_SOON：那个别名的类型是 BadgeVariant（几个变体的联合），
        // 而 BadgeOptions 是按变体分支的可辨识联合，联合类型对不上具体的那一支。
        { variant: 'I', text: '敬请期待', scale: rect.width / SOON_SCALE_BASE },
        this.deps,
      )
      badge.position.set(-badge.boxWidth / 2, -badge.boxHeight / 2)
      lift.addChild(badge)
    } else {
      slot.eventMode = 'static'
      slot.cursor = 'pointer'
      // 命中区就是卡那块矩形。精灵的包围盒在悬停放大时每帧都在变，拿它当命中区会抖。
      slot.hitArea = new Rectangle(-rect.width / 2, -rect.height / 2, rect.width, rect.height)
      slot.on('pointerover', (event) => {
        if (event.pointerType !== 'mouse') return
        this.setHovered(index)
      })
      slot.on('pointerout', (event) => {
        if (event.pointerType !== 'mouse') return
        if (this.hovered === index) this.setHovered(null)
      })
      slot.on('pointertap', () => this.onOpen?.(hero.id))
    }

    this.addChild(slot)
    return { slot, lift, rect, soon }
  }

  /** 抬起或落回。上浮、放大、转角一起补间，时长一致。 */
  private pose(index: number, lifted: boolean): void {
    const card = this.cards[index]
    if (card === undefined || card.soon) return
    const { animator } = this.deps
    animator.tween(card.lift, {
      y: lifted ? -card.rect.height * HOVER_LIFT_RATIO : 0,
      rotation: lifted ? (HOVER_TILT_DEG * Math.PI) / 180 : 0,
      duration: HOVER_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })
    const scale = lifted ? HOVER_SCALE : 1
    animator.tween(card.lift.scale, {
      x: scale,
      y: scale,
      duration: HOVER_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }

  /**
   * 「点击查看技能」那句提示（需求单提示 B）。
   *
   * 跟着悬停走，摆在卡的下沿。每换一张就重建一颗气泡：`Bubble` 建好之后不能改内容
   *（同 Label 的理由），而这一步一秒最多发生几次。
   */
  private refreshHint(): void {
    if (this.hint !== null) {
      killAndDestroy(this.deps.animator, this.hint)
      this.hint = null
    }
    const index = this.hovered
    if (index === null) return
    const card = this.cards[index]
    if (card === undefined || card.soon) return
    const bubble = new Bubble(
      { variant: BUBBLE_TIP, content: '点击查看技能', maxWidth: card.rect.width },
      this.deps,
    )
    bubble.position.set(
      card.rect.x + (card.rect.width - bubble.boxWidth) / 2,
      card.rect.y + card.rect.height - bubble.boxHeight / 2,
    )
    this.addChild(bubble)
    this.hint = bubble
    // 建出来是藏着的（见 Bubble.ts），要自己叫一次淡入。
    bubble.show()
  }
}
