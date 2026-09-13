/**
 * 选英雄页那两排卡：七张人物卡原画，加上入场、悬停的上浮 / 放大 / 三维倾斜，
 * 和「点击查看技能」那一条提示。
 *
 * 摆的是**整张原画**而不是 `CardSprite`，理由见 heroCard.ts。倾斜、反光、卡下投影
 * 都归那一份，这里只管「摆在哪、什么时候抬起来、指针在卡面的哪一点」。
 *
 * 还没实装的几位（`comingSoon`）照原位渲染，但压一层灰 tint、整张压暗，并盖一块
 *「敬请期待」的素方块，指针交互整套都不挂。少渲染一张会让后面所有卡对错人，
 * 而且玩家会以为这游戏只有四位英雄。
 *
 * ## 一张卡分三层，谁写什么各管各的
 *
 *   slot   版式给的落点写在它身上，悬停不碰它；命中区就挂在这里
 *   lift   入场和悬停的上浮 / 放大 / 淡入写在它身上
 *   art    跟指针倾斜（`CardTilt` 逐帧写 `setTilt`）和反光写在它里面
 *
 * 分三层是旧版 `.hero__card` / `.hero__card-lift` / `.hero__card-tilt` 的原样——
 * 一层 transform 只许一个人写。
 */

import { tokens } from '@ai-duel/design'
import { Container, Point as PixiPoint, Rectangle } from 'pixi.js'
import { Box, type BoxDeps } from '../../components/Box'
import { CardTilt } from '../../components/cardTilt'
import { CARD_WIDTH } from '../../layout/fanMath'
import type { Animator } from '../../runtime/animator'
import { killAndDestroy } from '../../runtime/dispose'
import { HeroCardArt, type HeroCardArtDeps } from './heroCard'
import type { HeroEntry } from './heroContract'
import type { HeroLayout, HeroRect } from './heroLayout'
import {
  HINT_FADE,
  HOVER_DUR,
  HOVER_LIFT_RATIO,
  HOVER_SCALE,
  HOVER_TILT_DEG,
  INTRO_CARD,
  INTRO_EASE,
} from './timings'

/**
 * 「敬请期待」那块牌和悬停提示那一条在**设计稿上**多大，以及提示离卡上沿多远。
 *
 * 数出自 `hero.css`：角标是一块 103×31 的小牌（见令牌 `color.soon.paper` 的说明）压在卡面
 * 64% 处；提示 `.hero__card-hint` 摆在 `top: 0.9cqi`（= 15），高是字号 14.4 加上下内边距。
 * 两块都按「卡实际多宽 ÷ 设计稿上多宽」跟着卡一起缩——手机档的卡只有一半宽。
 */
const SOON_BADGE = { width: 103, height: 31, top: 0.64 } as const
const HINT = { width: 116, height: 27, top: 15 } as const
/** 上面那两块是按这个卡宽量的（`.hero__card` 的 12.5cqi）。 */
const DESIGN_CARD_WIDTH = 209

/**
 * 目录页没有真指针，`hoverCard` 把倾斜的光心按在卡面的这一点上。
 *
 * 取左上偏内一点而不是正中：正中的倾斜角是 0、反光也在正中，那一条基线就看不出
 * 三维倾斜和反光到底接上了没有。
 */
const STORY_POINTER = { x: 0.28, y: 0.3 } as const

export type HeroGridDeps = BoxDeps & { animator: Animator; card: HeroCardArtDeps }

/** 一张卡在这一层里的东西。 */
interface HeroCard {
  /** 外层：版式给的落点写在它身上，悬停不碰它。 */
  slot: Container
  /** 中层：入场和悬停的上浮、放大、淡入都写在它身上。 */
  lift: Container
  /** 内层：那张原画，跟指针倾斜和反光都在它里面。 */
  art: HeroCardArt
  /** 这张卡的倾斜跟随。`comingSoon` 的那几位是 null（整套指针交互都不挂）。 */
  tilt: CardTilt | null
  rect: HeroRect
  soon: boolean
}

export class HeroGrid extends Container {
  private readonly deps: HeroGridDeps
  private readonly heroes: readonly HeroEntry[]
  private readonly cards: HeroCard[] = []
  /** 指针换算的落脚点。复用同一个，逐次调用不产生堆分配（3.10）。 */
  private readonly scratch = new PixiPoint()
  private hovered: number | null = null
  private hint: Box | null = null
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

  /**
   * 按一档版式重建整层。换版式时卡的尺寸全变了，重建比逐个改省事也更不容易漏。
   *
   * @param intro 要不要演一遍入场。只有头一次摆版式要——换窗口尺寸时整页重新入场太吵。
   */
  place(layout: HeroLayout, intro: boolean): void {
    for (const child of this.removeChildren()) killAndDestroy(this.deps.animator, child)
    this.cards.length = 0
    this.hovered = null
    this.hint = null
    this.heroes.forEach((hero, index) => {
      const rect = layout.cards[index]
      if (rect === undefined) return
      this.cards.push(this.build(hero, rect, index))
    })
    if (intro) this.playIntro()
  }

  /**
   * 把悬停摆到第 index 张（null 是不停）。目录页和真指针走的是同一条路。
   *
   * 目录页那条还顺手把倾斜的光心按在 `STORY_POINTER` 上：那边没有指针事件，
   * 不按一下的话这一条基线拍出来是张平卡。真指针进来时紧接着就有 `pointermove` 覆盖它。
   */
  setHovered(index: number | null): void {
    if (index === this.hovered) return
    const before = this.hovered
    this.hovered = index
    if (before !== null) this.pose(before, false)
    if (index !== null) {
      this.pose(index, true)
      this.cards[index]?.tilt?.setPointer(STORY_POINTER.x, STORY_POINTER.y)
    }
    this.refreshHint()
  }

  /**
   * 详情开在第 index 张身上（null 是没开）：那一张先藏起来。
   *
   * 屏幕中央和原位同时出现两张一模一样的卡会穿帮。藏的是 `lift` 而不是整个 `slot`：
   * 命中区挂在 slot 上，连它一起藏的话指针事件也停了，而详情一关指针多半还停在这张卡上，
   * 那时就收不到 `pointerout`、卡会一直吊在抬起的姿态上。
   */
  setZoomed(index: number | null): void {
    this.cards.forEach((card, position) => {
      card.lift.visible = position !== index
    })
  }

  /**
   * 第 index 张卡现在画在舞台的哪儿（舞台坐标），交给展示层当飞入的起点、飞回的落点。
   *
   * 要带上悬停那一下的抬起和放大：点开详情的那一刻指针就停在这张卡上，它是抬着的，
   * 按格子的原位起飞会在第一帧跳一下（旧版是用 `Flip.getState` 当场量的，同一件事）。
   * 落点按**卡的底边中点**给——展示层和卡牌的原点都在那儿（见 heroCard.ts）。
   */
  revealPointOf(index: number): { x: number; y: number; scale: number } | null {
    const card = this.cards[index]
    if (card === undefined) return null
    const { rect, lift, slot } = card
    return {
      x: slot.x,
      y: slot.y + lift.y + (rect.height / 2) * lift.scale.y,
      scale: (rect.width / CARD_WIDTH) * lift.scale.x,
    }
  }

  /** 逐帧推倾斜的收敛，返回还有没有事情在做（不报的话帧循环会提前停掉，3.6）。 */
  advance(deltaMs: number): boolean {
    let busy = false
    for (const card of this.cards) {
      if (card.tilt?.advance(deltaMs) === true) busy = true
    }
    return busy
  }

  private build(hero: HeroEntry, rect: HeroRect, index: number): HeroCard {
    const slot = new Container()
    slot.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2)
    const lift = new Container()
    slot.addChild(lift)

    /*
     * 原画的坐标是基准尺寸（150 宽、原点在底边中点），所以摆进格子要两步：
     * 先往下让半张卡让底边对上格子的底边，再按「格子多宽 ÷ 150」整体缩放。
     */
    const art = new HeroCardArt(hero.art, this.deps.card)
    art.position.set(0, rect.height / 2)
    art.scale.set(rect.width / CARD_WIDTH)
    lift.addChild(art)

    const soon = hero.comingSoon === true
    let tilt: CardTilt | null = null
    if (soon) {
      /*
       * 不挂 Filter（3.1）：旧版那句 grayscale 滤镜换成一层灰 tint 加整张压暗。
       * 压暗写在**原画**上而不是外面那层：角标要留在这层里跟着卡一起缩放和上浮，
       * 但它是「这张还没做完」的说明，跟着一起变淡就没人看得见了。
       */
      art.tint = tokens.color.hero.soonTint
      art.alpha = tokens.opacity.hero.soonCard
      lift.addChild(this.buildSoonBadge(rect))
    } else {
      tilt = new CardTilt(art, true, HOVER_TILT_DEG)
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
      /*
       * 倾斜跟着指针在**卡面上的相对位置**走，所以这一路要自己量。
       * 坐标取这一层的局部坐标：卡阵挂在舞台根上、自己没有变换，于是它的局部坐标就是舞台坐标，
       * 而版式给的那块矩形也在舞台坐标里，两边直接相减。
       */
      slot.on('pointermove', (event) => {
        if (event.pointerType !== 'mouse' || this.hovered !== index) return
        const point = event.getLocalPosition(this, this.scratch)
        tilt?.setPointer((point.x - rect.x) / rect.width, (point.y - rect.y) / rect.height)
      })
      slot.on('pointertap', () => this.onOpen?.(hero.id))
    }

    this.addChild(slot)
    return { slot, lift, art, tilt, rect, soon }
  }

  /** 「敬请期待」那块小牌：压在卡面偏下（上面是脸、最底下是卡面自带的名字牌，两处都不能压）。 */
  private buildSoonBadge(rect: HeroRect): Box {
    const scale = rect.width / DESIGN_CARD_WIDTH
    const width = SOON_BADGE.width * scale
    const height = SOON_BADGE.height * scale
    const badge = new Box({ width, height, label: '敬请期待', size: 'small' }, this.deps)
    badge.position.set(-width / 2, rect.height * (SOON_BADGE.top - 0.5))
    return badge
  }

  /**
   * 入场（抄旧版 `HeroScreen.tsx` 那条时间线的卡牌那一段）：淡入 + 从下方微微升起 +
   * 从 0.96 放到原大，按 DOM 顺序（第一排从左到右、再第二排）错峰 0.05。
   *
   * 整条线记一笔账就够（见 runtime/animator.ts），所以用 timeline 而不是七条各自的补间。
   * 被悬停的 `overwrite: 'auto'` 顶掉是允许的：那说明玩家已经把指针压上来了，
   * 这时候还把卡拽回入场的半路才是错的。
   */
  private playIntro(): void {
    if (this.cards.length === 0) return
    const timeline = this.deps.animator.timeline({ defaults: { ease: INTRO_EASE } })
    this.cards.forEach((card, index) => {
      const at = INTRO_CARD.at + index * INTRO_CARD.stagger
      timeline.fromTo(
        card.lift,
        { alpha: 0, y: card.rect.height * INTRO_CARD.sink },
        { alpha: 1, y: 0, duration: INTRO_CARD.duration },
        at,
      )
      timeline.fromTo(
        card.lift.scale,
        { x: INTRO_CARD.scale, y: INTRO_CARD.scale },
        { x: 1, y: 1, duration: INTRO_CARD.duration },
        at,
      )
    })
  }

  /** 抬起或落回。上浮和放大一起补间，时长一致；倾斜归 `CardTilt`，不在这里碰。 */
  private pose(index: number, lifted: boolean): void {
    const card = this.cards[index]
    if (card === undefined || card.soon) return
    const { animator } = this.deps
    animator.tween(card.lift, {
      y: lifted ? -card.rect.height * HOVER_LIFT_RATIO : 0,
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
    // 收手要让倾斜归零，不然指针一走卡就歪在那儿不动了。
    if (!lifted) card.tilt?.release()
  }

  /**
   * 「点击查看技能」那一条提示。
   *
   * 跟着悬停走，摆在卡上沿里侧（同旧版 `.hero__card-hint` 的 `top: 0.9cqi`）。
   * 挂在 `lift` 上而不是这一层：旧版那一条就长在抬起层里，跟着卡一起上浮和放大；
   * 顺带也就跟着 `setZoomed` 一起藏起来，不会在详情的暗幕背后留一块。
   * 每换一张就重建一块：素方块建好之后只有 `setLabel` 能换内容，而这一步一秒最多发生几次。
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
    const scale = card.rect.width / DESIGN_CARD_WIDTH
    const width = HINT.width * scale
    const height = HINT.height * scale
    const hint = new Box({ width, height, label: '点击查看技能', size: 'small' }, this.deps)
    // lift 的原点在卡心上，所以横向让半块、纵向从卡的上沿往下量。
    hint.position.set(-width / 2, -card.rect.height / 2 + HINT.top * scale)
    card.lift.addChild(hint)
    this.hint = hint
    this.deps.animator.fromTo(hint, { alpha: 0 }, { alpha: 1, duration: HINT_FADE })
  }
}
