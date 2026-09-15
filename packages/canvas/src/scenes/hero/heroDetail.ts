/**
 * 技能详情浮层（需求单弹窗 C）：暗幕升起、卡从原位飞到一侧放大、另一侧摊开技能说明，
 * 底下两颗钮（返回 / 确认英雄）；关掉时卡飞回原来那一格。
 *
 * 展示那一段整个复用 `RevealOverlay`（`inspect-*` 那条链路用的是同一份）：遮罩、飞行时长、
 * 层级都不再另写一遍。这里只多三样它不管的东西——右边那一栏说明（一摞素方块）、
 * 底下两颗钮，以及大卡跟指针倾斜。
 *
 * **没有翻面**：对局里放大一张技能牌会翻到背面看说明，而英雄卡只有正面一张原画，
 * 说明本来就摊在旁边那一栏里。硬给它造一个背面等于凭空多一套要维护的美术。
 *
 * 暗幕只盖得住**舞台**那一块，盖不到舞台之外的留边——留边上那一圈挡边是盖在舞台之上的
 *（见 scenes/duel/stageFrame.ts）。旧版那一层是 `position: fixed`、连留边一起压暗的，
 * 对局页和组牌页的展示层同样有这处出入，三页一致。
 */

import { Container, Point as PixiPoint } from 'pixi.js'
import { BOX_FONT_SIZE, Box, type BoxDeps } from '../../components/Box'
import { CardTilt } from '../../components/cardTilt'
import {
  RevealOverlay,
  type RevealOverlayDeps,
  type RevealPoint,
} from '../../components/RevealOverlay'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import { killAndDestroy } from '../../runtime/dispose'
import { HeroCardArt, type HeroCardArtDeps } from './heroCard'
import type { HeroEntry } from './heroContract'
import type { HeroLayout, HeroRect } from './heroLayout'
import { DETAIL_CHROME_FADE, HOVER_TILT_DEG } from './timings'

export type HeroDetailDeps = BoxDeps & RevealOverlayDeps & { card: HeroCardArtDeps }

/**
 * 暗幕：抄黑客松 `.hero__detail-veil` 的 `rgb(5 8 12 / 82%)`。
 *
 * 不进设计令牌，和 `components/Box.ts` 里那几个颜色同一个理由：视觉后面整套重做，
 * 这一版只要「压得够暗」这件事成立。那一版还叠了 14px 的背景模糊，这里没有（要挂 Filter，3.1）。
 */
const VEIL = { color: 0x05080c, alpha: 0.82 } as const

/**
 * 说明栏那一摞方块：每一行多高、行与行之间留多宽。
 *
 * 单行的三档（名字、英文名、小标题）高度就是「字号 + 上下留白」，成段的正文是先建出来
 * 量一遍字高再定高（素方块的折行见 components/Box.ts 的 `wrap`）。
 */
const ROW = {
  name: BOX_FONT_SIZE.title + 16,
  en: BOX_FONT_SIZE.small + 12,
  label: BOX_FONT_SIZE.body + 14,
  copyPad: 12,
  gap: 8,
  /** 一段说明（小标题 + 正文）和上一段之间多留一点。 */
  sectionGap: 16,
} as const

/** 详情里那两颗钮各自发什么，以及飞回原位要问哪儿。 */
export interface HeroDetailHandlers {
  onClose(): void
  onConfirm(hero: string): void
  /** 这位英雄在卡阵里那一格的落点（舞台坐标）。查不到就原地淡出，不飞。 */
  origin(hero: string): RevealPoint | null
}

/**
 * 详情浮层。它自己就是那一层——`RevealOverlay` 管卡和暗幕，说明和按钮挂在它旁边，
 * 一起藏一起显。
 */
export class HeroDetail extends Container {
  private readonly deps: HeroDetailDeps
  private readonly handlers: HeroDetailHandlers
  private readonly reveals = new Container()
  private readonly chrome = new Container()
  /** 指针换算的落脚点。复用同一个，逐次调用不产生堆分配。 */
  private readonly scratch = new PixiPoint()
  private overlay: RevealOverlay | null = null
  private card: HeroCardArt | null = null
  private tilt: CardTilt | null = null
  private layout: HeroLayout | null = null
  private openedId: string | null = null
  /** 最后一次 `setOpen` 的入参。换版式要重建整层，拿它把画面恢复回去。 */
  private opened: { hero: HeroEntry; confirmable: boolean } | null = null

  constructor(deps: HeroDetailDeps, handlers: HeroDetailHandlers) {
    super()
    this.deps = deps
    this.handlers = handlers
    this.label = 'hero-detail'
    this.visible = false
    this.addChild(this.reveals, this.chrome)
  }

  /**
   * 换一档版式。
   *
   * 展示层是建的时候把「卡停在哪、放多大」焊死的（`RevealOverlay` 的构造参数），
   * 所以换版式一律重建整层。这一步只在窗口尺寸变化时发生。
   */
  place(layout: HeroLayout): void {
    this.layout = layout
    const opened = this.opened
    this.rebuildOverlay(layout)
    // 重建之后原来开着的那一份就没了，按最后一份状态再开一次。
    if (opened !== null) this.open(opened.hero, opened.confirmable)
  }

  /**
   * 开在某位身上，或者关掉（`hero` 传 null）。
   * `heroes` 传进来是为了让这一层自己去查那位是谁——调用方只握着一个 id。
   */
  setOpen(hero: HeroEntry | null, confirmable: boolean): void {
    if (hero === null) {
      if (this.openedId === null) return
      const leaving = this.openedId
      this.openedId = null
      this.close(leaving)
      return
    }
    if (hero.id === this.openedId) return
    this.openedId = hero.id
    this.open(hero, confirmable)
  }

  /** 目前开着谁，没开是 null。 */
  get openedHero(): string | null {
    return this.openedId
  }

  /** 逐帧推大卡倾斜的收敛，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean {
    return this.tilt?.advance(deltaMs) === true
  }

  private rebuildOverlay(layout: HeroLayout): void {
    if (this.overlay !== null) killAndDestroy(this.deps.animator, this.overlay)
    this.reveals.removeChildren()
    const overlay = new RevealOverlay(
      {
        scale: layout.detail.scale,
        anchorX: layout.detail.anchorX,
        anchorY: layout.detail.anchorY,
        veil: VEIL,
      },
      this.deps,
    )
    overlay.resize(layout.width, layout.height)
    // 点暗幕就关：这一层整个吃指针事件（见 RevealOverlay），挂上回调它才有反应。
    overlay.on('pointertap', () => this.handlers.onClose())
    /*
     * 大卡也跟指针倾斜（旧版 `.hero__detail-card-tilt` 那一层）。监听挂在暗幕上而不是卡上：
     * 暗幕铺满整层，指针在说明栏那一侧时卡也该跟着歪，挂在卡上就只有压在卡面上时才有反应。
     */
    overlay.on('pointermove', (event) => {
      const card = this.card
      if (card === null) return
      const point = event.getLocalPosition(this, this.scratch)
      // 卡的原点在底边中点（见 heroCard.ts），所以纵向要加一整张、横向加半张才归到 0~1。
      const local = card.toLocal(point, this, this.scratch)
      this.tilt?.setPointer(local.x / CARD_WIDTH + 0.5, local.y / CARD_HEIGHT + 1)
    })
    this.reveals.addChild(overlay)
    this.overlay = overlay
  }

  private open(hero: HeroEntry, confirmable: boolean): void {
    const layout = this.layout
    const overlay = this.overlay
    if (layout === null || overlay === null) return
    this.opened = { hero, confirmable }
    this.openedId = hero.id
    this.visible = true

    /*
     * 大卡和卡阵里那张是**两个对象**，不是把原来那张借过来：那张要留在原位当飞回的落点，
     * 而且它正被卡阵那一层的悬停补间写着。旧版靠 Flip 在两个节点之间配对，同一个道理。
     * 原画本身就是基准尺寸（150×225），放多大归展示层的 `scale`。
     */
    const card = new HeroCardArt(hero.art, this.deps.card)
    this.card = card
    this.tilt = new CardTilt(card, true, HOVER_TILT_DEG)
    overlay.enter(card, this.handlers.origin(hero.id))

    this.buildChrome(layout, hero, confirmable)
  }

  /**
   * 收掉详情：卡飞回原来那一格（查不到原位就原地淡出），说明和按钮跟着暗幕一起淡出。
   *
   * 说明和按钮不是当场消失：暗幕那一段要演 0.6 秒，这边直接藏起来的话画面上会先少一半、
   * 再等暗幕慢慢化开。卡是这一层自己建的（不像对局那边是从手牌借来的），飞完得自己收。
   */
  private close(hero: string): void {
    this.opened = null
    const card = this.card
    this.card = null
    this.tilt?.reset()
    this.tilt = null
    // 淡出期间还可能被再次打开，所以先把这一批挪进一个临时层，新开的那份不受影响。
    const leaving = new Container()
    for (const child of this.chrome.removeChildren()) leaving.addChild(child)
    this.chrome.addChild(leaving)
    const back = this.handlers.origin(hero)
    const flight = back === null ? this.overlay?.fade() : this.overlay?.landTo(back)
    this.deps.animator.tween(leaving, {
      alpha: 0,
      duration: DETAIL_CHROME_FADE,
      ease: 'power2.in',
      onComplete: () => killAndDestroy(this.deps.animator, leaving),
    })
    /*
     * 卡等飞完才销毁，而且单独记一条：展示层的 `landTo` 只负责把卡从自己身上摘下来，
     * 收不收归建它的人。这半秒里可能又开了一位，所以藏整层那一下要再确认一次没人开着。
     */
    this.deps.animator.timeline().call(
      () => {
        if (card !== null) killAndDestroy(this.deps.animator, card)
        if (this.opened === null) this.visible = false
      },
      undefined,
      (flight ?? 0) / 1000,
    )
  }

  private buildChrome(layout: HeroLayout, hero: HeroEntry, confirmable: boolean): void {
    for (const child of this.chrome.removeChildren()) killAndDestroy(this.deps.animator, child)
    const info = new Container()
    info.position.set(layout.detail.info.x, layout.detail.info.y)
    this.fillInfo(info, layout.detail.info, hero)
    this.chrome.addChild(info)
    this.buildButtons(layout, hero, confirmable)
    // 说明和钮一起淡入：不淡的话它们会在暗幕还没升起时就整块出现。
    this.deps.animator.fromTo(
      this.chrome,
      { alpha: 0 },
      { alpha: 1, duration: DETAIL_CHROME_FADE, ease: 'power2.out', overwrite: 'auto' },
    )
  }

  /** 说明栏：名字、英文名，再往下一段段「小标题 + 正文」，一行一块素方块摞下去。 */
  private fillInfo(host: Container, rect: HeroRect, hero: HeroEntry): void {
    let y = 0
    const add = (box: Box): void => {
      box.position.set(0, y)
      host.addChild(box)
      y += box.boxHeight + ROW.gap
    }
    add(
      new Box({ width: rect.width, height: ROW.name, label: hero.name, size: 'title' }, this.deps),
    )
    add(
      new Box({ width: rect.width, height: ROW.en, label: hero.enName, size: 'small' }, this.deps),
    )

    const sections = [
      { label: '人物简介', text: hero.text },
      { label: hero.skillName, text: hero.skillText },
      ...(hero.roleText === undefined ? [] : [{ label: '定位', text: hero.roleText }]),
    ]
    for (const section of sections) {
      y += ROW.sectionGap - ROW.gap
      add(
        new Box(
          { width: rect.width, height: ROW.label, label: section.label, align: 'left' },
          this.deps,
        ),
      )
      /*
       * 正文要折行，而折成几行事先不知道：先按一行的高建出来，读一次字高再把方块撑到那么高。
       * 折行宽度是建的时候按内宽定死的，改高度不会让字重新折（见 Box 的 setSize）。
       */
      const copy = new Box(
        {
          width: rect.width,
          height: ROW.label,
          label: section.text,
          size: 'small',
          align: 'left',
          wrap: true,
        },
        this.deps,
      )
      copy.setSize(rect.width, copy.textHeight + ROW.copyPad * 2)
      add(copy)
    }
  }

  /** 底下那一排钮：纯查看时只有「返回」，真选英雄时多一颗「确认英雄」。 */
  private buildButtons(layout: HeroLayout, hero: HeroEntry, confirmable: boolean): void {
    const { buttons } = layout.detail
    const specs: { caption: string; run: () => void }[] = [
      { caption: '返回', run: () => this.handlers.onClose() },
      ...(confirmable
        ? [{ caption: '确认英雄', run: () => this.handlers.onConfirm(hero.id) }]
        : []),
    ]
    const total = specs.length * buttons.width + (specs.length - 1) * buttons.gap
    let x = (layout.width - total) / 2
    for (const spec of specs) {
      const button = new Box(
        { width: buttons.width, height: buttons.height, label: spec.caption, size: 'title' },
        this.deps,
      )
      button.onPress(spec.run)
      button.position.set(x, buttons.y)
      this.chrome.addChild(button)
      x += buttons.width + buttons.gap
    }
  }
}
