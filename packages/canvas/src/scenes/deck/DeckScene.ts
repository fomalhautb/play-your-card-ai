/**
 * 牌组编辑场景（《正式版架构》迁移第 28 条）：卡池、牌组栏、拖拽、放大查看。
 *
 * 契约和分工见 `scenes/deckContract.ts`。这个文件本身只做四件事：
 * 建渲染器和零件、把状态摆成画面、收玩家的输入、往外报改动。真正的活分散在旁边几个文件里：
 *   logic/      分页、落点、让位、筛选、合法性（纯函数，先行做的一层）
 *   layout/     两档版式（桌面 / 手机，并列不缩放）
 *   parts.ts    建组件、分层、按版式摆位
 *   state.ts    此刻的状态和改它的那几条纯函数
 *   render.ts   状态 → 画面
 *   input.ts    拖拽和轻点
 *
 * 契约里那几条硬要求落在这个文件：显式走 WebGL 不开 WebGPU（3.8）；手动时钟下不注册任何
 * 真实时间源、真实时钟下没有动画就停帧循环（3.6）；上下文丢失时把烤出来的纹理重画一遍（4.3）。
 */

import type { CardId } from '@ai-duel/core'
import { tokens } from '@ai-duel/design'
import { autoDetectRenderer, Container, type Renderer } from 'pixi.js'
import type { CardSprite } from '../../components/CardSprite'
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
import { type CardPool, createCardPool } from './cards'
import type { DeckContext } from './context'
import { addFromPool, createDeckInput, type DeckInput } from './input'
import { createDeckInspect, type DeckInspect } from './inspect'
import { createDeckLabels, type DeckLabels } from './labels'
import { pickDeckLayout } from './layout/pickLayout'
import type { DeckLayout } from './layout/types'
import { pageInsertIndex } from './logic/pagination'
import { DEFAULT_DECK_RULES } from './logic/types'
import { createDeckParts, type DeckParts } from './parts'
import { ALL_FACTIONS, currentPage, poolPageCount, renderDeckScene } from './render'
import {
  createDeckState,
  currentCards,
  type DeckState,
  selectDeck,
  selectFaction,
  selectKind,
  setDrawerOpen,
  setPage,
} from './state'

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
    background: tokens.color.page.background,
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
  private readonly stage = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: DuelDeps
  private readonly visuals: CardVisuals
  private readonly cards: CardPool
  private readonly ownsRenderer: boolean
  private readonly ctx: DeckContext
  private layout: DeckLayout
  private parts: DeckParts
  private input: DeckInput
  /**
   * 这一轮借出去摆着的卡，以及上一轮那批（`stale`）。
   *
   * 「上一轮借过、这一轮还要」的卡从 `stale` 里原样取回来——它因此仍然挂在原来那一格上，
   * 一次重挂都不用（重排画面是这一页最频繁的事，见 render.ts 的文件头）。
   * 这一轮没再被要到的，到 `endBorrow` 那一步才真的还回回收池。
   */
  private borrowed = new Map<CardSprite, CardId>()
  private stale = new Map<CardSprite, CardId>()
  /** 放大查看那一小块状态（见 inspect.ts）。 */
  private readonly inspect: DeckInspect
  /** 页码和「已选 N / 20」那两行会变的字（见 labels.ts）。 */
  private readonly labels: DeckLabels
  private destroyed = false
  private onChangeCb: ((decks: readonly DeckView[], currentId: string) => void) | null = null
  private onInspectCb: ((cardId: CardId) => void) | null = null
  private onManageCb: ((action: DeckManageAction) => void) | null = null

  constructor(renderer: Renderer, options: DeckSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.options = options
    this.ownsRenderer = ownsRenderer
    this.layout = pickDeckLayout(options.width, options.height, options.coarsePointer)
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
      // 这一页的卡不跟指针倾斜，反光层建了也永远不亮，理由见 deps.ts 的 `glare`。
      glare: false,
      // 一屏二三十张卡平铺在格子里，每张再垫一层比卡还大的半透明投影就是白烧填充率。
      cardShadow: false,
      wake: () => this.frameLoop.wake(),
    })
    this.visuals = createCardVisuals(options.catalog, options.textures, options.cardFaces)
    this.cards = createCardPool(this.deps, this.visuals)
    this.parts = this.buildParts()
    this.ctx = this.makeContext(options)
    this.labels = createDeckLabels(() => this.parts, this.deps)
    this.inspect = createDeckInspect({
      // 走取值器：换一档版式会把零件整套换掉，焊死一份迟早指向已经销毁的东西。
      parts: () => this.parts,
      cards: this.cards,
      wake: () => this.frameLoop.wake(),
      onShow: (cardId) => this.onInspectCb?.(cardId),
    })
    this.input = createDeckInput(this.ctx)
    this.bindStage()
    renderDeckScene(this.ctx)
    // 4.3：上下文丢了之后把「画出来的」纹理重画一遍。图片纹理 Pixi 自己会重传，这几张不会。
    options.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    this.render(0)
  }

  private buildParts(): DeckParts {
    return createDeckParts({
      stage: this.stage,
      deps: this.deps,
      layout: this.layout,
      onBack: this.options.onBack,
      onConfirm: () => this.options.onConfirm?.(currentCards(this.ctx.state)),
      onKind: (id) => this.change((state) => selectKind(state, id as DeckState['kind'])),
      onFaction: (id) =>
        this.change((state) => selectFaction(state, id === ALL_FACTIONS ? null : id)),
      onDeck: (id) => {
        this.change((state) => selectDeck(state, id))
        this.ctx.emitChange()
      },
      onNewDeck: () => this.manage({ kind: 'create' }),
      onRename: () => this.manage({ kind: 'rename', id: this.ctx.state.currentId }),
      onDelete: () => this.manage({ kind: 'delete', id: this.ctx.state.currentId }),
      onRemoveAt: (index) => this.removeAt(index),
      onDrawer: () => this.toggleDrawer(),
      onPage: (delta) => this.turnPage(delta),
      onAddAt: (index) => this.addAt(index),
    })
  }

  /**
   * 组装上下文。`parts` 和 `layout` 走取值器：换档位会整套换掉零件、改视口会换掉版式，
   * 而 render 和 input 手里的是同一个对象，取值器让它们始终看到当前那一份。
   */
  private makeContext(options: DeckSceneOptions): DeckContext {
    const scene = this
    return {
      pool: options.pool,
      factions: options.factions,
      rules: options.rules ?? DEFAULT_DECK_RULES,
      get parts() {
        return scene.parts
      },
      get layout() {
        return scene.layout
      },
      // 手机档一进来抽屉是收着的：卡池才是这一屏的主角。桌面档没有抽屉，恒为展开。
      state: createDeckState(options.decks, options.currentId, scene.layout.tier === 'desktop'),
      gap: null,
      dragging: null,

      takeCard: (cardId, tag) => {
        // 上一轮那批里有同一张牌的话原样取回来：它还在原位，谁都不用动。
        for (const [card, id] of this.stale) {
          if (id !== cardId) continue
          this.stale.delete(card)
          this.borrowed.set(card, cardId)
          return card
        }
        const card = this.cards.take(cardId, tag)
        this.borrowed.set(card, cardId)
        return card
      },
      holdCard: (cardId, tag) => this.cards.take(cardId, tag),
      beginBorrow: () => {
        this.stale = this.borrowed
        this.borrowed = new Map()
      },
      endBorrow: () => {
        for (const [card, cardId] of this.stale) this.cards.release(card, cardId)
        this.stale.clear()
      },
      releaseCard: (card, cardId) => this.cards.release(card, cardId),
      setPageLabel: (text) => this.labels.setPage(text),
      setTally: (text) => this.labels.setTally(text),
      wake: () => this.frameLoop.wake(),
      emitChange: () => this.onChangeCb?.(this.ctx.state.decks, this.ctx.state.currentId),
      emitInspect: (cardId) => this.inspect.show(cardId),
      emitManage: (action) => this.manage(action),
    }
  }

  /** 改名 / 新建 / 删除三件事都要弹框，交给调用方。 */
  private manage(action: DeckManageAction): void {
    this.onManageCb?.(action)
  }

  /** 改一次状态并重排画面。所有「点了某个控件」最后都走这条。 */
  private change(next: (state: DeckState) => DeckState): void {
    this.ctx.state = next(this.ctx.state)
    renderDeckScene(this.ctx)
  }

  private turnPage(delta: number): void {
    const pages = poolPageCount(this.ctx)
    const next = Math.min(Math.max(0, currentPage(this.ctx) + delta), pages - 1)
    this.change((state) => setPage(state, next))
  }

  /** 点卡池第 index 格的「＋」。落点是当前这一页的第一格，口径见 logic/pagination.ts。 */
  private addAt(index: number): void {
    const at = pageInsertIndex(
      currentPage(this.ctx),
      this.parts.poolCells.length,
      currentCards(this.ctx.state).length,
    )
    addFromPool(this.ctx, index, at)
  }

  /** 手机档：开关抽屉。桌面档牌组栏一直摊着，这一下什么都不做。 */
  private toggleDrawer(): void {
    if (this.layout.drawer === null) return
    this.change((state) => setDrawerOpen(state, !state.drawerOpen))
  }

  private removeAt(index: number): void {
    const cards = currentCards(this.ctx.state)
    if (index < 0 || index >= cards.length) return
    this.change((state) => ({
      ...state,
      decks: state.decks.map((deck) =>
        deck.id === state.currentId
          ? { ...deck, cards: [...deck.cards.slice(0, index), ...deck.cards.slice(index + 1)] }
          : deck,
      ),
    }))
    this.ctx.emitChange()
  }

  /** 舞台上的指针：拖拽走合成入口那三条，点遮罩关掉放大查看。 */
  private bindStage(): void {
    this.stage.eventMode = 'static'
    this.stage.on('pointerdown', (event) => {
      if (this.inspect.open) return
      this.input.pressAt(event.global.x, event.global.y, event.pointerType)
    })
    this.stage.on('globalpointermove', (event) => this.input.moveTo(event.global.x, event.global.y))
    this.stage.on('pointerup', (event) => this.input.releaseAt(event.global.x, event.global.y))
    this.stage.on('pointerupoutside', (event) =>
      this.input.releaseAt(event.global.x, event.global.y),
    )
    this.parts.reveal.on('pointertap', () => this.inspect.hide())
  }

  /**
   * 推进一帧但不渲染。返回还有没有事情在做。
   *
   * 这一页**没有自己的虚拟时钟**（不像对局场景要按 cue 的 `at` 排演出）：
   * 补间归 GSAP，而 GSAP 的时间由帧循环统一推（见 runtime/frameLoop.ts）。
   * 所以这里只回答「还忙不忙」，一个时间参数都不需要。
   */
  private advance(): boolean {
    return !this.idle()
  }

  private render(_deltaMs: number): void {
    this.renderer.render(this.stage)
  }

  private idle(): boolean {
    return !this.deps.animator.isBusy() && !this.input.isBusy()
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
      pressAt: (x, y) => this.input.pressAt(x, y),
      moveTo: (x, y) => this.input.moveTo(x, y),
      releaseAt: (x, y) => this.input.releaseAt(x, y),
      turnPage: (delta) => this.turnPage(delta),
      toggleDrawer: () => this.toggleDrawer(),
    }
  }

  mounted(): MountedDeckScene {
    return { ...this.handle(), root: this.stage, advance: () => this.advance() }
  }

  private resize(width: number, height: number): void {
    if (width === this.layout.width && height === this.layout.height) return
    const next = pickDeckLayout(width, height, this.options.coarsePointer)
    this.renderer.resize(width, height)
    this.layout = next
    /*
     * 改尺寸和换档位走的是同一条路：整套零件重建。
     *
     * 对局场景那边分了两条（同一档内只 `applyPartsLayout`），这里不分——构筑页的三块底板
     *（面板 A / B / D）几何是**画死**的，尺寸一变就得换一块新的，而它们正是这一页的主体。
     * 留一条只挪位置的快路等于让底板停在旧尺寸上，比重建更糟。
     */
    this.rebuild()
    this.frameLoop.wake()
  }

  /** 换一套零件，把状态重新摆一遍。改视口和换档位都走这里。 */
  private rebuild(): void {
    const state = this.ctx.state
    this.input.destroy()
    this.returnAllCards()
    this.inspect.hide()
    for (const child of this.stage.removeChildren()) child.destroy({ children: true })
    this.parts = this.buildParts()
    this.ctx.state = state
    this.labels.reset()
    this.input = createDeckInput(this.ctx)
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
    this.input.destroy()
    this.returnAllCards()
    // 顺序要紧：先掐补间再还 GSAP 的时钟，理由见对局场景 DuelScene 的 destroy。
    destroyDeps(this.deps)
    this.frameLoop.destroy()
    this.cards.dispose()
    // 只销毁场景自己建的东西：调用方传进来的卡面纹理不归我们管（谁加载谁负责）。
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
