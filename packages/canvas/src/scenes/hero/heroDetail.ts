/**
 * 技能详情浮层（需求单弹窗 C）：暗幕升起、卡飞到一侧放大、另一侧摊开技能说明，
 * 底下两颗匾额（返回 / 确认英雄）。
 *
 * 展示那一段整个复用 `RevealOverlay`（`inspect-*` 那条链路用的是同一份）：
 * 遮罩、飞行时长、层级都不再另写一遍。这里只多两样它不管的东西——
 * 右边那一栏说明（`InfoCard` 的变体 N）和底下两颗钮。
 *
 * **没有翻面**：对局里放大一张技能牌会翻到背面看说明，而英雄卡只有正面一张原画，
 * 说明本来就摊在旁边那一栏里。硬给它造一个背面等于凭空多一套要维护的美术。
 */

import { Container, Sprite } from 'pixi.js'
import { INFO_CARD_HERO, InfoCard, type InfoCardDeps } from '../../components/InfoCard'
import {
  PLAQUE_IVORY,
  PLAQUE_PAPER,
  PlaqueButton,
  type PlaqueButtonDeps,
  type PlaqueVariant,
} from '../../components/PlaqueButton'
import { RevealOverlay, type RevealOverlayDeps } from '../../components/RevealOverlay'
import { REVEAL_FADE_OUT_MS } from '../../director/timings'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import { killAndDestroy } from '../../runtime/dispose'
import type { HeroEntry } from './heroContract'
import type { HeroLayout, HeroRect } from './heroLayout'

export type HeroDetailDeps = InfoCardDeps & PlaqueButtonDeps & RevealOverlayDeps

/** 详情里那两颗钮各自发什么。 */
export interface HeroDetailHandlers {
  onClose(): void
  onConfirm(hero: string): void
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
  private overlay: RevealOverlay | null = null
  private card: Sprite | null = null
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
      this.openedId = null
      this.close()
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

  private rebuildOverlay(layout: HeroLayout): void {
    if (this.overlay !== null) killAndDestroy(this.deps.animator, this.overlay)
    this.reveals.removeChildren()
    const overlay = new RevealOverlay(
      { scale: layout.detail.scale, anchorX: layout.detail.anchorX },
      this.deps,
    )
    overlay.resize(layout.width, layout.height)
    // 点暗幕就关：这一层整个吃指针事件（见 RevealOverlay），挂上回调它才有反应。
    overlay.on('pointertap', () => this.handlers.onClose())
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

    const card = new Sprite(hero.art)
    card.anchor.set(0.5, 1)
    // 展示层按「卡面基准尺寸乘 scale」算落点，所以这张原画也得先摆成基准尺寸。
    card.setSize(CARD_WIDTH, CARD_HEIGHT)
    this.card = card
    overlay.enter(card, null)

    this.buildChrome(layout, hero, confirmable)
  }

  /**
   * 收掉详情。
   *
   * 说明和按钮那一层跟着暗幕一起淡出，不是当场消失：`RevealOverlay.fade()` 要演 0.3 秒，
   * 这边直接藏起来的话画面上会先少一半、再等暗幕慢慢化开。
   * 淡完才真的销毁——卡是这一层自己建的（不像对局那边是从手牌借来的），得自己收。
   */
  private close(): void {
    this.opened = null
    const card = this.card
    this.card = null
    // 淡出期间还可能被再次打开，所以先把这一批挪进一个临时层，新开的那份不受影响。
    const leaving = new Container()
    for (const child of this.chrome.removeChildren()) leaving.addChild(child)
    this.chrome.addChild(leaving)
    this.overlay?.fade()
    this.deps.animator.tween(leaving, {
      alpha: 0,
      duration: REVEAL_FADE_OUT_MS / 1000,
      ease: 'power2.in',
      onComplete: () => {
        killAndDestroy(this.deps.animator, leaving)
        if (card !== null) killAndDestroy(this.deps.animator, card)
        // 这半秒里可能又开了一位，那就别把新开的一起藏掉。
        if (this.opened === null) this.visible = false
      },
    })
  }

  private buildChrome(layout: HeroLayout, hero: HeroEntry, confirmable: boolean): void {
    for (const child of this.chrome.removeChildren()) killAndDestroy(this.deps.animator, child)
    const info = new InfoCard(
      {
        variant: INFO_CARD_HERO,
        width: layout.detail.info.width,
        name: hero.name,
        enName: hero.enName,
        scale: infoScale(layout.detail.info),
        sections: [
          { label: '人物简介', text: hero.text },
          { label: hero.skillName, text: hero.skillText },
          ...(hero.roleText === undefined ? [] : [{ label: '定位', text: hero.roleText }]),
        ],
      },
      this.deps,
    )
    info.position.set(layout.detail.info.x, layout.detail.info.y)
    this.chrome.addChild(info)
    info.show()

    const { buttons } = layout.detail
    const specs: { caption: string; variant: PlaqueVariant; run: () => void }[] = [
      { caption: '返回', variant: PLAQUE_PAPER, run: () => this.handlers.onClose() },
      ...(confirmable
        ? [
            {
              caption: '确认英雄',
              variant: PLAQUE_IVORY,
              run: () => this.handlers.onConfirm(hero.id),
            },
          ]
        : []),
    ]
    const total = specs.length * buttons.width + (specs.length - 1) * buttons.gap
    let x = (layout.width - total) / 2
    for (const spec of specs) {
      const button = new PlaqueButton(
        { variant: spec.variant, caption: spec.caption, size: 'hero', onActivate: spec.run },
        this.deps,
      )
      // 版式给的宽是设计值，按钮自己按令牌建出来多半差几个像素，居中摆进那一格。
      button.position.set(x + (buttons.width - button.boxWidth) / 2, buttons.y)
      this.chrome.addChild(button)
      x += buttons.width + buttons.gap
    }
  }
}

/**
 * 说明栏的整体缩放。
 *
 * `InfoCard` 的字号是按设计稿（1440 宽下 432 的那一栏）定的，这一栏在窄屏上只有一半宽，
 * 字不跟着缩就会挤成一坨。按「实际宽 ÷ 设计宽」缩，并夹在 0.7~1.15 之间——
 * 再小就读不清，再大就比标题还抢眼。
 */
function infoScale(info: HeroRect): number {
  return Math.min(1.15, Math.max(0.7, info.width / 432))
}
