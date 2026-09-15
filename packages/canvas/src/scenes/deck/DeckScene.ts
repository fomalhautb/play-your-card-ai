/**
 * 牌组编辑场景（《正式版架构》迁移第 28 条）：卡池、牌组栏、拖拽、放大查看。
 *
 * 契约和分工见 `scenes/deckContract.ts`。这个文件只管**搭起来**：建渲染器、建零件、
 * 装上下文、接指针、推帧循环。真正的活分散在旁边：logic/（落点、筛选、合法性、分页）、
 * layout/（两档版式）、parts*.ts（建零件 / 摆零件）、state.ts、scroll.ts（滚动算术）、
 * render.ts（状态 → 画面）、input.ts + drop.ts（滚动、拖拽、轻点）、hover.ts（指到哪张）、
 * dragFx.ts（那几段补间）、inspect.ts（放大查看）、commands.ts（按钮接什么）。
 *
 * 契约里那几条硬要求落在这个文件：显式走 WebGL 不开 WebGPU（3.8）；手动时钟下不注册任何
 * 真实时间源、真实时钟下没有动画就停帧循环（3.6）；上下文丢失时把烤出来的纹理重画一遍（4.3）。
 *
 * 坐标：桌面档的舞台是 1672×941 的死版式，整块缩放居中放进视口（同对局场景）。
 * **对外那三个指针入口收的是视口坐标**，进来先过一次 `toStage`；
 * 场景内部、版式、input / hover / inspect 一律只认舞台坐标。
 */

import type { CardId } from '@ai-duel/core'
import { autoDetectRenderer, Container, Graphics, Rectangle, type Renderer } from 'pixi.js'
import { CANVAS_BACKGROUND } from '../../components/Box'
import { FrameLoop } from '../../runtime/frameLoop'
import type {
  DeckManageAction,
  DeckScene,
  DeckSceneCounters,
  DeckSceneOptions,
  DeckView,
} from '../deckContract'
import { type CardVisuals, createCardVisuals } from '../duel/cardVisuals'
import { createDuelDeps, type DuelDeps, destroyDeps, restoreDeps } from '../duel/deps'
import { paintStageFrame } from '../duel/stageFrame'
import { originPointOf } from './anchors'
import { type CardPool, createCardPool } from './cards'
import {
  addAtCell,
  changeFilter,
  insertIndex,
  removeSlot,
  toggleDrawer,
  turnScreen,
} from './commands'
import type { DeckContext } from './context'
import { createDeckHover, type DeckHover } from './hover'
import { addFromPool, createDeckInput, type DeckInput } from './input'
import { createDeckInspect, type DeckInspect } from './inspect'
import { pickDeckLayout } from './layout/pickLayout'
import type { DeckLayout } from './layout/types'
import { createDeckParts, type DeckParts } from './parts'
import { bindDeckPointer, deckWheelHandler, type PointerHost, toStage } from './pointer'
import { createRefuse, type Refuse } from './refuse'
import { ALL_FACTIONS, renderDeckScene } from './render'
import { createDeckContext } from './sceneContext'
import { ScrollState } from './scroll'
import { currentCards, type DeckState, selectDeck, selectFaction, selectKind } from './state'

export async function createDeckScene(options: DeckSceneOptions): Promise<DeckScene> {
  const renderer = await autoDetectRenderer({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    // 3.8：显式走 WebGL。数组形式是排除式的——WebGPU 不在名单里就整个不试。
    preference: ['webgl'],
    antialias: true,
    autoDensity: true,
    background: CANVAS_BACKGROUND,
  })
  return new DeckSceneImpl(renderer, options, true).handle()
}

/** 挂在别人的渲染器上的场景：多一个根节点和一个「只推进不渲染」的入口（同对局场景）。 */
export interface MountedDeckScene extends DeckScene {
  readonly root: Container
  advance(deltaMs: number): boolean
}

export function mountDeckScene(renderer: Renderer, options: DeckSceneOptions): MountedDeckScene {
  return new DeckSceneImpl(renderer, options, false).mounted()
}

/** 场景的全部可变状态。拆成类只是为了让下面那堆闭包有个明确的家，它不对外导出。 */
class DeckSceneImpl {
  private readonly renderer: Renderer
  private readonly options: DeckSceneOptions
  /** 交给渲染器的那个根。舞台是它缩放居中之后的一层。 */
  private readonly root = new Container()
  private readonly stage = new Container()
  /** 挂在别人渲染器上时垫在舞台下面那块底；自己建渲染器时清屏色已经是同一个颜色。 */
  private readonly backdrop: Graphics | null
  private readonly letterbox = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: DuelDeps
  private readonly visuals: CardVisuals
  private readonly cards: CardPool
  private readonly ownsRenderer: boolean
  private readonly ctx: DeckContext
  private readonly poolScroll = new ScrollState()
  private readonly slotScroll = new ScrollState()
  /**
   * 那几路**逐帧跟随**还在不在动：滚动惯性、倾斜收敛。
   *
   * 它们不是 GSAP 补间，`Animator` 记不到账，所以要自己记一笔——不记的话帧循环会以为
   * 没事在做而停掉（3.6），卡歪在半路上不动（同对局场景的 `interactionBusy`）。
   */
  private interactionBusy = false
  /** 指针那一层要的取值器。整套零件会被换掉，所以一律走函数而不是焊死一份。 */
  private readonly pointerHost: PointerHost
  private layout: DeckLayout
  private parts: DeckParts
  private input: DeckInput
  private hover: DeckHover
  private readonly inspect: DeckInspect
  private readonly refuseFx: Refuse
  private destroyed = false
  private onChangeCb: ((decks: readonly DeckView[], currentId: string) => void) | null = null
  private onInspectCb: ((cardId: CardId) => void) | null = null
  private onManageCb: ((action: DeckManageAction) => void) | null = null

  constructor(renderer: Renderer, options: DeckSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.options = options
    this.ownsRenderer = ownsRenderer
    this.layout = pickDeckLayout(options.width, options.height, options.coarsePointer)
    this.backdrop = ownsRenderer ? null : new Graphics()
    this.frameLoop = new FrameLoop({
      manual: options.manualClock === true,
      render: (deltaMs) => this.render(deltaMs),
      isBusy: () => !this.idle(),
    })
    this.deps = createDuelDeps({
      renderer,
      tier: options.tier,
      seed: options.seed ?? 0,
      back: options.textures.back,
      platform: options.platform,
      /*
       * 这一页的卡**要**跟指针倾斜（黑客松卡池、格子、放大层三处都挂着），所以反光层照建。
       * 它平时 `visible` 为 false，只有指着的那一张才亮——同屏最多一层，
       * 不会像「每张都铺一层」那样吃掉填充率（3.2）。
       */
      cardShadow: true,
      wake: () => this.frameLoop.wake(),
    })
    this.pointerHost = {
      stage: this.stage,
      canvas: options.canvas,
      layout: () => this.layout,
      parts: () => this.parts,
      input: () => this.input,
      hover: () => this.hover,
      inspect: () => this.inspect,
      wake: () => this.frameLoop.wake(),
    }
    this.visuals = createCardVisuals(options.catalog, options.textures, options.cardFaces)
    this.cards = createCardPool(this.deps, this.visuals)
    if (this.backdrop !== null) this.root.addChild(this.backdrop)
    this.root.addChild(this.stage, this.letterbox)
    this.parts = this.buildParts()
    // 走取值器：上下文是下面一行才装好的，零件也会被整套换掉。
    this.refuseFx = createRefuse({ ctx: () => this.ctx, tip: () => this.parts.tip })
    this.ctx = createDeckContext(options, {
      // 走取值器：换一档版式会把零件整套换掉，焊死一份迟早指向已经销毁的东西。
      parts: () => this.parts,
      layout: () => this.layout,
      cards: this.cards,
      animator: this.deps.animator,
      stage: this.stage,
      cardTilt: this.deps.cardTilt,
      poolScroll: this.poolScroll,
      slotScroll: this.slotScroll,
      wake: () => this.frameLoop.wake(),
      emitChange: () => this.onChangeCb?.(this.ctx.state.decks, this.ctx.state.currentId),
      emitInspect: (origin) => this.inspect.show(origin),
      refuse: (cardId, card) => this.refuseFx.show(cardId, card),
      emitManage: (action) => this.manage(action),
    })
    this.inspect = createDeckInspect({
      // 走取值器：换一档版式会把零件整套换掉，焊死一份迟早指向已经销毁的东西。
      parts: () => this.parts,
      layout: () => this.layout,
      cards: this.cards,
      animator: this.deps.animator,
      stage: this.stage,
      cardTilt: this.deps.cardTilt,
      wake: () => this.frameLoop.wake(),
      originPoint: (origin) => originPointOf(this.ctx, origin),
      onShow: (cardId) => this.onInspectCb?.(cardId),
    })
    this.input = createDeckInput(this.ctx)
    this.hover = createDeckHover(this.ctx)
    this.applyStageTransform()
    this.bindStage()
    renderDeckScene(this.ctx)
    // 4.3：上下文丢了之后把「画出来的」纹理重画一遍。图片纹理 Pixi 自己会重传，这几张不会。
    options.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    options.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.render(0)
  }

  private buildParts(): DeckParts {
    return createDeckParts({
      stage: this.stage,
      deps: this.deps,
      layout: this.layout,
      poolSize: this.options.pool.length,
      onBack: this.options.onBack,
      onConfirm: () => this.options.onConfirm?.(currentCards(this.ctx.state)),
      onKind: (id) => changeFilter(this.ctx, (state) => selectKind(state, id as DeckState['kind'])),
      onFaction: (id) =>
        changeFilter(this.ctx, (state) => selectFaction(state, id === ALL_FACTIONS ? null : id)),
      onDeck: (id) => {
        changeFilter(this.ctx, (state) => selectDeck(state, id))
        this.ctx.emitChange()
      },
      onNewDeck: () => this.manage({ kind: 'create' }),
      onRename: () => this.manage({ kind: 'rename', id: this.ctx.state.currentId }),
      onDelete: () => this.manage({ kind: 'delete', id: this.ctx.state.currentId }),
      onRemoveAt: (index) => removeSlot(this.ctx, index),
      onDrawer: () => toggleDrawer(this.ctx),
      onPage: (delta) => turnScreen(this.ctx, delta),
      onAddAt: (slot) => addAtCell(this.ctx, slot),
      onZoomAdd: () => this.zoomAction(),
      onZoomClose: () => this.inspect.hide(),
    })
  }

  /** 改名 / 新建 / 删除三件事都要弹框，交给调用方。 */
  private manage(action: DeckManageAction): void {
    this.onManageCb?.(action)
  }

  /** 放大层那一行的第一颗钮：从卡池点开的是「加入牌组」，从牌组点开的是「移出牌组」。 */
  private zoomAction(): void {
    const origin = this.inspect.origin
    if (origin === null) return
    this.inspect.hide()
    if (origin.from === 'deck') {
      removeSlot(this.ctx, origin.index)
      return
    }
    addFromPool(this.ctx, origin.index, insertIndex(this.ctx))
  }

  /** 把真指针接到三个合成入口上。换一套零件之后要重接一次（监听挂在舞台和展示层上）。 */
  private bindStage(): void {
    bindDeckPointer(this.pointerHost)
  }

  private readonly onWheel = (event: WheelEvent): void => deckWheelHandler(this.pointerHost)(event)

  /**
   * 把舞台缩放居中放进视口，并按设计尺寸给它一块命中区。
   * 缩放之后短边留出的那一圈边因此不在命中区里——它不属于这一页，点了不该有反应。
   */
  private applyStageTransform(): void {
    const { stage } = this.layout
    this.stage.scale.set(stage.scale)
    this.stage.position.set(stage.x, stage.y)
    this.stage.hitArea = new Rectangle(0, 0, this.layout.width, this.layout.height)
    paintStageFrame(this.backdrop, this.letterbox, this.layout)
  }

  /**
   * 推进一帧但不渲染。返回还有没有事情在做。
   *
   * 这一页**没有自己的虚拟时钟**（不像对局场景要按 cue 的 `at` 排演出）：
   * 补间归 GSAP，而 GSAP 的时间由帧循环统一推（见 runtime/frameLoop.ts）。
   * 这里推的是那几路逐帧跟随：滚动惯性、倾斜收敛。
   */
  private advance(deltaMs: number): boolean {
    const scrolling = this.input.advance(deltaMs)
    const tilting = this.hover.advance(deltaMs)
    const zooming = this.inspect.advance(deltaMs)
    this.interactionBusy = scrolling || tilting || zooming
    return !this.idle()
  }

  private render(deltaMs: number): void {
    this.advance(deltaMs)
    this.renderer.render(this.root)
  }

  private idle(): boolean {
    return !this.deps.animator.isBusy() && !this.input.isBusy() && !this.interactionBusy
  }

  handle(): DeckScene {
    return {
      applyDecks: (decks, currentId) => {
        this.ctx.state = { ...this.ctx.state, decks: decks.map((one) => ({ ...one })), currentId }
        renderDeckScene(this.ctx)
      },
      onChange: (callback) => {
        this.onChangeCb = callback
      },
      onInspect: (callback) => {
        this.onInspectCb = callback
      },
      onManage: (callback) => {
        this.onManageCb = callback
      },
      step: (deltaMs) => this.frameLoop.step(deltaMs),
      isIdle: () => this.idle(),
      counters: (): DeckSceneCounters => ({
        textCreated: this.deps.text.textCreated,
        ...this.frameLoop.counters(),
      }),
      resize: (width, height) => this.resize(width, height),
      destroy: () => this.destroy(),
      pressAt: (x, y) => {
        const at = toStage(this.layout, x, y)
        this.input.pressAt(at.x, at.y)
      },
      moveTo: (x, y) => {
        const at = toStage(this.layout, x, y)
        this.input.moveTo(at.x, at.y)
      },
      releaseAt: (x, y) => {
        const at = toStage(this.layout, x, y)
        this.input.releaseAt(at.x, at.y)
      },
      turnPage: (delta) => turnScreen(this.ctx, delta),
      toggleDrawer: () => toggleDrawer(this.ctx),
    }
  }

  mounted(): MountedDeckScene {
    return { ...this.handle(), root: this.root, advance: (deltaMs) => this.advance(deltaMs) }
  }

  private resize(width: number, height: number): void {
    const next = pickDeckLayout(width, height, this.options.coarsePointer)
    if (
      next.viewport.width === this.layout.viewport.width &&
      next.viewport.height === this.layout.viewport.height
    ) {
      return
    }
    this.renderer.resize(width, height)
    const sameStage = next.tier === this.layout.tier && next.width === this.layout.width
    this.layout = next
    /*
     * 舞台尺寸没变（桌面档只是缩放比不同）就只改一个 transform：那一档的每一块底板
     * 都是照 1672×941 画死的，换视口不用重画。换档位或换到手机档那条按视口实算的路
     * 才要整套重建——那时候底板的几何真的变了。
     */
    if (sameStage) this.applyStageTransform()
    else this.rebuild()
    this.frameLoop.wake()
  }

  /** 换一套零件，把状态重新摆一遍。改视口和换档位都走这里。 */
  private rebuild(): void {
    const state = this.ctx.state
    this.input.destroy()
    this.hover.release()
    this.interactionBusy = false
    this.returnAllCards()
    this.inspect.hide()
    for (const child of this.stage.removeChildren()) child.destroy({ children: true })
    this.parts = this.buildParts()
    this.ctx.state = state
    this.poolScroll.reset()
    this.slotScroll.reset()
    this.input = createDeckInput(this.ctx)
    this.hover = createDeckHover(this.ctx)
    this.applyStageTransform()
    this.bindStage()
    renderDeckScene(this.ctx)
  }

  /** 把借出去的卡一张不留地还回回收池。换一套零件和拆场景各用一次。 */
  private returnAllCards(): void {
    this.ctx.beginBorrow()
    this.ctx.endBorrow()
  }

  private readonly onContextRestored = (): void => {
    restoreDeps(this.deps)
    this.frameLoop.wake()
  }

  /**
   * 拆场景。调第二次直接返回——Pixi 的 `renderer.destroy()` 会把内部几个系统的表置成 null，
   * 第二次进去就在 null 上取属性，当场抛 TypeError（同对局场景）。
   */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.options.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.options.canvas.removeEventListener('wheel', this.onWheel)
    this.input.destroy()
    this.returnAllCards()
    // 顺序要紧：先掐补间再还 GSAP 的时钟，理由见对局场景 DuelScene 的 destroy。
    destroyDeps(this.deps)
    this.frameLoop.destroy()
    this.cards.dispose()
    // 只销毁场景自己建的东西：调用方传进来的卡面纹理不归我们管（谁加载谁负责）。
    this.root.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
