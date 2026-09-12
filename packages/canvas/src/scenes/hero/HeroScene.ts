/**
 * 选英雄页渲染器（需求单里归 canvas 的那一页）。
 *
 * 层叠自下而上：背景图 → 返回 / 标题 / 副标题 → 两排卡 → 技能详情浮层。
 * 这一页**受控**：选中谁、详情开在谁身上都由装配层通过 `setView` 摆进来，
 * 场景自己只管悬停（理由见 heroContract.ts）。
 *
 * 这个文件只做四件事：建渲染器、推帧循环、摆版式、把各层发出的操作转给调用方。
 * 版式在 heroLayout.ts、卡阵在 heroGrid.ts、详情在 heroDetail.ts。
 */

import { tokens } from '@ai-duel/design'
import { createFakePlatform } from '@ai-duel/platform'
import { autoDetectRenderer, Container, type Renderer, Sprite } from 'pixi.js'
import { Flourish } from '../../components/Flourish'
import { Label } from '../../components/Label'
import { TEXT_BUTTON_BACK, TextButton } from '../../components/TextButton'
import { bakeUiTextures } from '../../fx/uiTextures'
import { Animator } from '../../runtime/animator'
import { killAndDestroy } from '../../runtime/dispose'
import { FrameLoop } from '../../runtime/frameLoop'
import { TextTextureCache } from '../../runtime/textCache'
import type { HeroAction, HeroScene, HeroSceneOptions, HeroView } from './heroContract'
import { HeroDetail, type HeroDetailDeps } from './heroDetail'
import { HeroGrid, type HeroGridDeps } from './heroGrid'
import { type HeroLayout, pickHeroLayout } from './heroLayout'

/** 标题和副标题。纯查看和选英雄两种口径的差别在装配层（这一版两条入口说的是同一句）。 */
const TITLE = '选择你的英雄'
const SUBTITLE = '每位英雄自带一个改变对局的技能'

export async function createHeroScene(options: HeroSceneOptions): Promise<HeroScene> {
  const renderer = await autoDetectRenderer({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    // 3.8：显式走 WebGL。数组形式是排除式的——WebGPU 不在名单里就整个不试。
    preference: ['webgl'],
    antialias: true,
    autoDensity: true,
    background: tokens.color.page.background,
  })
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
  private readonly stage = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: HeroGridDeps & HeroDetailDeps
  private readonly options: HeroSceneOptions
  private readonly background = new Sprite()
  private readonly chrome = new Container()
  private readonly grid: HeroGrid
  private readonly detail: HeroDetail
  private readonly ownsRenderer: boolean
  private viewport: { width: number; height: number }
  private layout: HeroLayout
  private view: HeroView = { selectedId: null, detailId: null, confirmable: true }
  private onAction: ((action: HeroAction) => void) | null = null
  private destroyed = false

  constructor(renderer: Renderer, options: HeroSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.options = options
    this.ownsRenderer = ownsRenderer
    this.viewport = { width: options.width, height: options.height }
    this.frameLoop = new FrameLoop({
      manual: options.manualClock === true,
      render: () => this.render(),
      isBusy: () => !this.idle(),
    })
    this.deps = {
      ui: bakeUiTextures(renderer),
      text: new TextTextureCache(renderer),
      animator: new Animator(() => this.frameLoop.wake()),
      platform: options.platform ?? createFakePlatform(),
      // 按钮按下那一声。资源不归 canvas 管（音效是第 33 条的事）。
      clickSound: null,
    }

    if (options.background !== undefined) this.background.texture = options.background
    this.grid = new HeroGrid(options.heroes, this.deps)
    this.grid.setOnOpen((hero) => this.onAction?.({ kind: 'open', hero }))
    this.detail = new HeroDetail(this.deps, {
      onClose: () => this.onAction?.({ kind: 'close' }),
      onConfirm: (hero) => this.onAction?.({ kind: 'confirm', hero }),
    })
    this.stage.addChild(this.background, this.chrome, this.grid, this.detail)

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

  private applyLayout(): void {
    // 背景铺满视口。它是一张 16:9 的整图，窄屏上按「盖满」裁，不留黑边。
    const cover = Math.max(
      this.viewport.width / (this.background.texture.width || 1),
      this.viewport.height / (this.background.texture.height || 1),
    )
    this.background.anchor.set(0.5)
    this.background.scale.set(cover)
    this.background.position.set(this.viewport.width / 2, this.viewport.height / 2)
    this.buildChrome()
    this.grid.place(this.layout)
    this.detail.place(this.layout)
  }

  /** 标题、副标题、返回那一层。换版式整层重建（同首页的理由）。 */
  private buildChrome(): void {
    for (const child of this.chrome.removeChildren()) killAndDestroy(this.deps.animator, child)
    const { title, subtitle, back } = this.layout

    const heading = new Label(
      TITLE,
      {
        fontSize: title.fontSize,
        weight: '600',
        letterSpacing: title.fontSize * 0.24,
        maxWidth: this.viewport.width * 0.8,
      },
      this.deps,
      tokens.color.hero.name,
    )
    heading.position.set(title.x, title.y)
    this.chrome.addChild(heading)

    // 标题两侧各挂一支花饰，星朝内（同首页副标题的摆法）。
    const wing = title.fontSize * 3.4
    const gap = heading.textWidth / 2 + title.fontSize * 0.7
    for (const side of [-1, 1] as const) {
      const flourish = new Flourish(
        {
          width: wing,
          starSize: title.fontSize * 0.6,
          sides: side < 0 ? 'right' : 'left',
          color: tokens.color.hero.goldDim,
        },
        this.deps,
      )
      flourish.position.set(
        side < 0 ? title.x - gap - wing : title.x + gap,
        title.y - flourish.boxHeight / 2,
      )
      this.chrome.addChild(flourish)
    }

    const caption = new Label(
      SUBTITLE,
      {
        fontSize: subtitle.fontSize,
        letterSpacing: subtitle.fontSize * 0.12,
        maxWidth: this.viewport.width * 0.85,
      },
      this.deps,
      tokens.color.hero.goldDim,
    )
    caption.position.set(subtitle.x, subtitle.y)
    this.chrome.addChild(caption)

    const backButton = new TextButton(
      {
        variant: TEXT_BUTTON_BACK,
        caption: '返回',
        fontSize: back.fontSize,
        color: tokens.color.hero.goldDim,
        litColor: tokens.color.hero.name,
        onActivate: () => this.onAction?.({ kind: 'back' }),
      },
      this.deps,
    )
    backButton.position.set(back.x, back.y)
    this.chrome.addChild(backButton)
  }

  /** 这一页动的只有补间，全在 animator 账上，所以画一帧不需要自己推任何虚拟时钟。 */
  private render(): void {
    this.renderer.render(this.stage)
  }

  private idle(): boolean {
    return !this.deps.animator.isBusy()
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
      root: this.stage,
      advance: () => !this.idle(),
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
    this.detail.setOpen(hero, view.confirmable)
    this.paint()
  }

  /**
   * 摆完新东西之后立刻画一帧，理由同 RoomScene 的 `paint`：Pixi 的命中判定读的是
   * `worldTransform`，而那份变换只在渲染时才算——不补这一帧，刚建出来的按钮点不中。
   */
  private paint(): void {
    this.frameLoop.wake()
    if (this.ownsRenderer) this.renderer.render(this.stage)
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
    this.deps.ui.destroy()
    this.deps.text.destroy()
    // 外面给的纹理不归这里收（那是调用方的资源）。
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
