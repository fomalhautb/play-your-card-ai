/**
 * 选英雄页渲染器（需求单里归 canvas 的那一页）。
 *
 * 层叠自下而上：舞台底 → 返回 / 标题 / 副标题 → 两排卡 → 技能详情浮层 → 舞台四周那圈挡边。
 * 这一页**受控**：选中谁、详情开在谁身上都由装配层通过 `setView` 摆进来，
 * 场景自己只管悬停（理由见 heroContract.ts）。
 *
 * 桌面档是 1672×941 的死版式整块等比缩放居中（同对局页和组牌页，见 heroLayout.ts），
 * 所以舞台之外会多出两条边——那一圈挡边和（挂在别人渲染器上时）垫在底下那一块都走
 * `scenes/duel/stageFrame.ts`，三页共用一份。
 *
 * 整页的背景图在正式版简化第 4 步之五连源文件一起删了：这一版只剩素方块，
 * 渲染器的清屏色就是整页的底。
 *
 * 这个文件只做五件事：建渲染器、推帧循环、摆版式、把各层发出的操作转给调用方、
 * 逐帧推倾斜的收敛。版式在 heroLayout.ts、卡阵在 heroGrid.ts、详情在 heroDetail.ts、
 * 一张人物卡怎么画在 heroCard.ts。
 */

import { Container, Graphics, type Renderer } from 'pixi.js'
import { Box } from '../../components/Box'
import { Animator } from '../../runtime/animator'
import { killAndDestroy } from '../../runtime/dispose'
import { FrameLoop } from '../../runtime/frameLoop'
import { createSceneRenderer } from '../../runtime/sceneRenderer'
import { TextTextureCache } from '../../runtime/textCache'
import { paintStageFrame } from '../duel/stageFrame'
import { bakeHeroTextures, type HeroTextures } from './heroCard'
import type { HeroAction, HeroScene, HeroSceneOptions, HeroView } from './heroContract'
import { HeroDetail, type HeroDetailDeps } from './heroDetail'
import { HeroGrid, type HeroGridDeps } from './heroGrid'
import { type HeroLayout, pickHeroLayout } from './heroLayout'
import { INTRO_CHROME, INTRO_EASE } from './timings'

/** 标题和副标题。纯查看和选英雄两种口径的差别在装配层（这一版两条入口说的是同一句）。 */
const TITLE = '选择你的英雄'
const SUBTITLE = '每位英雄自带一个改变对局的技能'

export async function createHeroScene(options: HeroSceneOptions): Promise<HeroScene> {
  const renderer = await createSceneRenderer(options)
  return new HeroSceneImpl(renderer, options, true).handle()
}

/** 挂在别人的渲染器上的选英雄页（组件目录页那条路，理由同 mountRoomScene）。 */
export interface MountedHeroScene extends HeroScene {
  readonly root: Container
  /** 推进一帧但**不**渲染——渲染归外面那套帧循环。返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
}

export function mountHeroScene(renderer: Renderer, options: HeroSceneOptions): MountedHeroScene {
  return new HeroSceneImpl(renderer, options, false).mounted()
}

class HeroSceneImpl {
  private readonly renderer: Renderer
  /** 交给渲染器的那个根。舞台是它缩放居中之后的一层。 */
  private readonly root = new Container()
  private readonly stage = new Container()
  /** 挂在别人渲染器上时垫在舞台下面那块底；自己建渲染器时清屏色已经是同一个颜色。 */
  private readonly backdrop: Graphics | null
  private readonly letterbox = new Container()
  private readonly frameLoop: FrameLoop
  private readonly textures: HeroTextures
  private readonly deps: HeroGridDeps & HeroDetailDeps
  private readonly options: HeroSceneOptions
  private readonly chrome = new Container()
  private readonly grid: HeroGrid
  private readonly detail: HeroDetail
  private readonly ownsRenderer: boolean
  private viewport: { width: number; height: number }
  private layout: HeroLayout
  private view: HeroView = { selectedId: null, detailId: null, confirmable: true }
  private onAction: ((action: HeroAction) => void) | null = null
  /** 入场只在头一次摆版式时演一遍，换窗口尺寸不再重演。 */
  private introPlayed = false
  /**
   * 倾斜那一路还在不在收敛。
   *
   * 它不是 GSAP 补间，`Animator` 记不到账，所以要自己记一笔——不记的话帧循环会以为
   * 没事在做而停掉（3.6），卡歪在半路上不动（同对局和构筑两页）。
   */
  private tiltBusy = false
  private destroyed = false

  constructor(renderer: Renderer, options: HeroSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.options = options
    this.ownsRenderer = ownsRenderer
    this.viewport = { width: options.width, height: options.height }
    this.backdrop = ownsRenderer ? null : new Graphics()
    this.frameLoop = new FrameLoop({
      manual: options.manualClock === true,
      render: (deltaMs) => this.render(deltaMs),
      isBusy: () => !this.idle(),
    })
    this.textures = bakeHeroTextures(renderer)
    this.deps = {
      text: new TextTextureCache(renderer),
      animator: new Animator(() => this.frameLoop.wake()),
      /*
       * 这一页的卡要投影也要反光：同屏最多亮一张（只有指着的那张），
       * 不会像「每张都铺一层」那样吃掉填充率（3.2）。
       */
      card: { shadow: this.textures.shadow, glare: true },
    }

    this.grid = new HeroGrid(options.heroes, this.deps)
    this.grid.setOnOpen((hero) => this.onAction?.({ kind: 'open', hero }))
    this.detail = new HeroDetail(this.deps, {
      onClose: () => this.onAction?.({ kind: 'close' }),
      onConfirm: (hero) => this.onAction?.({ kind: 'confirm', hero }),
      origin: (hero) => this.grid.revealPointOf(this.indexOf(hero)),
    })
    this.stage.addChild(this.chrome, this.grid, this.detail)
    if (this.backdrop !== null) this.root.addChild(this.backdrop)
    this.root.addChild(this.stage, this.letterbox)

    this.layout = this.pick()
    this.applyLayout()
  }

  private pick(): HeroLayout {
    return pickHeroLayout(
      this.viewport.width,
      this.viewport.height,
      this.options.coarsePointer === true,
    )
  }

  /** 这位英雄排在第几位。查不到是 −1（卡阵那边照它返回 null）。 */
  private indexOf(hero: string): number {
    return this.options.heroes.findIndex((entry) => entry.id === hero)
  }

  /** 详情开在第几张卡上，没开是 null。卡阵照它把那一张藏起来。 */
  private zoomedIndex(): number | null {
    return this.view.detailId === null ? null : this.indexOf(this.view.detailId)
  }

  private applyLayout(): void {
    const { stage } = this.layout
    this.stage.scale.set(stage.scale)
    this.stage.position.set(stage.x, stage.y)
    paintStageFrame(this.backdrop, this.letterbox, this.layout)
    const intro = !this.introPlayed
    this.introPlayed = true
    this.buildChrome(intro)
    this.grid.place(this.layout, intro)
    // 卡阵是整层重建的，藏起来的那张要按现在这份状态重新藏一次。
    this.grid.setZoomed(this.zoomedIndex())
    this.detail.place(this.layout)
  }

  /**
   * 标题、副标题、返回那一层，三块素方块。换版式整层重建（同首页的理由）。
   *
   * 入场抄旧版那条时间线的头一段：三格从上方落下来、错峰 0.08。整条线记一笔账就够
   *（见 runtime/animator.ts）。
   */
  private buildChrome(intro: boolean): void {
    for (const child of this.chrome.removeChildren()) killAndDestroy(this.deps.animator, child)
    const { title, subtitle, back } = this.layout

    const backBox = new Box({ width: back.width, height: back.height, label: '返回' }, this.deps)
    backBox.position.set(back.x, back.y)
    backBox.onPress(() => this.onAction?.({ kind: 'back' }))

    const heading = new Box(
      { width: title.width, height: title.height, label: TITLE, size: 'title' },
      this.deps,
    )
    heading.position.set(title.x, title.y)

    const caption = new Box(
      { width: subtitle.width, height: subtitle.height, label: SUBTITLE, size: 'small' },
      this.deps,
    )
    caption.position.set(subtitle.x, subtitle.y)

    this.chrome.addChild(backBox, heading, caption)
    if (!intro) return
    const timeline = this.deps.animator.timeline({ defaults: { ease: INTRO_EASE } })
    ;[backBox, heading, caption].forEach((box, index) => {
      timeline.fromTo(
        box,
        { alpha: 0, y: box.y - box.boxHeight * INTRO_CHROME.rise },
        { alpha: 1, y: box.y, duration: INTRO_CHROME.duration },
        index * INTRO_CHROME.stagger,
      )
    })
  }

  /** 把倾斜那一路推一步，并记下还在不在收敛。 */
  private advanceTilts(deltaMs: number): void {
    const grid = this.grid.advance(deltaMs)
    const detail = this.detail.advance(deltaMs)
    this.tiltBusy = grid || detail
  }

  /** 画一帧：先把倾斜那一路推一步，再画。两档都不需要自己推任何虚拟时钟。 */
  private render(deltaMs: number): void {
    this.advanceTilts(deltaMs)
    this.renderer.render(this.root)
  }

  private idle(): boolean {
    return !this.deps.animator.isBusy() && !this.tiltBusy
  }

  handle(): HeroScene {
    return {
      setView: (view: HeroView) => this.setView(view),
      onAction: (callback: (action: HeroAction) => void) => {
        this.onAction = callback
      },
      hoverCard: (index: number | null) => this.grid.setHovered(index),
      step: (deltaMs) => this.frameLoop.step(deltaMs),
      isIdle: () => this.idle(),
      resize: (width, height) => this.resize(width, height),
      destroy: () => this.destroy(),
    }
  }

  mounted(): MountedHeroScene {
    return {
      ...this.handle(),
      root: this.root,
      advance: (deltaMs: number) => {
        this.advanceTilts(deltaMs)
        return !this.idle()
      },
    }
  }

  private setView(view: HeroView): void {
    const before = this.view
    this.view = view
    if (
      before.detailId === view.detailId &&
      before.confirmable === view.confirmable &&
      before.selectedId === view.selectedId
    ) {
      return
    }
    const hero = this.options.heroes.find((entry) => entry.id === view.detailId) ?? null
    // 详情开着时原位那张卡要藏起来：屏幕中央和原位同时出现两张一模一样的卡会穿帮。
    this.grid.setZoomed(this.zoomedIndex())
    this.detail.setOpen(hero, view.confirmable)
    this.paint()
  }

  /**
   * 摆完新东西之后立刻画一帧，理由同 RoomScene 的 `paint`：Pixi 的命中判定读的是
   * `worldTransform`，而那份变换只在渲染时才算——不补这一帧，刚建出来的按钮点不中。
   */
  private paint(): void {
    this.frameLoop.wake()
    if (this.ownsRenderer) this.renderer.render(this.root)
  }

  private resize(width: number, height: number): void {
    if (width === this.viewport.width && height === this.viewport.height) return
    this.viewport = { width, height }
    this.renderer.resize(width, height)
    this.layout = this.pick()
    this.applyLayout()
    this.paint()
  }

  /** 拆场景。调第二次直接返回（同 DuelScene / RoomScene 的理由）。 */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    // 顺序要紧：先掐补间，再还 GSAP 的时钟（同 DuelScene 的 destroy）。
    this.deps.animator.destroy()
    this.frameLoop.destroy()
    this.deps.text.destroy()
    this.textures.destroy()
    // 外面给的纹理不归这里收（那是调用方的资源）。
    this.root.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
