/**
 * 对局渲染器（《正式版架构》迁移第 18 条）：消费编排层的演出指令，把一局对战画出来。
 *
 * 它认得的只有三样东西——`PlayerView`、`Cue`、`DirectorLocks`（契约和分工见 duelContract.ts）。
 * 这个文件本身只做四件事：建渲染器和零件、推自己的虚拟时钟、把 cue 分给播放器、
 * 收玩家的输入往外发。真正的活分散在旁边几个文件里：
 *   layout/      两档版式（桌面 / 手机，并列不缩放）
 *   parts.ts     建组件、分层、按版式摆位
 *   applyView.ts 局面 → 画面的结构同步，以及演出播完之后的兜底对账
 *   cuePlayers/  一条 cue 怎么播（按演在屏幕哪个位置分组）
 *   input.ts     拖出出牌、点选目标、点开放大查看
 *
 * 契约里那几条硬要求落在这个文件：显式走 WebGL 不开 WebGPU（3.8）；手动时钟下不注册任何
 * 真实时间源、真实时钟下没有动画就停帧循环（3.6）；上下文丢失时把烤出来的纹理重画一遍（4.3）。
 */

import type { CardId, InstanceId } from '@ai-duel/core'
import { tokens } from '@ai-duel/design'
import { autoDetectRenderer, Container, Rectangle, type Renderer } from 'pixi.js'
import { CardSprite } from '../../components/CardSprite'
import type { DirectorLocks } from '../../director/director'
import { FrameLoop } from '../../runtime/frameLoop'
import type { DuelCommand, DuelScene, DuelSceneCounters, DuelSceneOptions } from '../duelContract'
import { warmupScene } from '../warmup'
import { applyView, reconcile } from './applyView'
import { type CardVisuals, createCardVisuals } from './cardVisuals'
import { clearScene } from './clearScene'
import { createSceneClock } from './clock'
import type { DuelContext } from './context'
import { playCue } from './cuePlayers/index'
import { createDuelDeps, type DuelDeps, destroyDeps, restoreDeps } from './deps'
import { deckPoseOf, tilePointOf } from './geometry'
import { makeHeroArt } from './heroArt'
import { createDuelInput, type DuelInput } from './input'
import { pickLayout } from './layout/pickLayout'
import type { DuelLayout } from './layout/types'
import { applyPartsLayout, createParts, type DuelParts } from './parts'
import { bakePlaceholderIcons, type DuelIcons } from './placeholderIcons'

export async function createDuelScene(options: DuelSceneOptions): Promise<DuelScene> {
  const renderer = await autoDetectRenderer({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    // 3.8：显式走 WebGL。数组形式是排除式的——WebGPU 不在名单里就整个不试。
    preference: ['webgl'],
    antialias: true,
    // 让 Pixi 顺手把 canvas 的 CSS 尺寸设成逻辑像素，画布分辨率才和 resolution 对得上。
    autoDensity: true,
    background: tokens.color.page.background,
  })
  const scene = new DuelSceneImpl(renderer, options, true)
  scene.warmup()
  return scene.handle()
}

/** 挂在别人的渲染器上的场景：多一个根节点和一个「只推进不渲染」的入口。 */
export interface MountedDuelScene extends DuelScene {
  /** 场景的根节点。外面把它挂到自己的舞台上。 */
  readonly root: Container
  /** 推进一帧但**不**渲染——渲染归外面那套帧循环。返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
}

/**
 * 把场景挂到一个**已经有的**渲染器上，帧循环和渲染都交给外面。
 *
 * 组件目录页用它：那边一条条目就是一块画布，渲染器、帧循环、固定步进都是目录页搭好的
 *（见 client 的 dev/storybook/pixiStory.tsx）。让场景自己再建一个渲染器就是两套帧循环
 * 抢同一条 GSAP 根时间线，补间会被推两遍。
 *
 * 渲染器不归它销毁（谁建的谁负责），别的东西照常自己收。
 */
export function mountDuelScene(renderer: Renderer, options: DuelSceneOptions): MountedDuelScene {
  const scene = new DuelSceneImpl(renderer, options, false)
  scene.warmup()
  return scene.mounted()
}

/** 场景的全部可变状态。拆成类只是为了让下面那堆闭包有个明确的家，它不对外导出。 */
class DuelSceneImpl {
  private readonly renderer: Renderer
  private readonly options: DuelSceneOptions
  private readonly stage = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: DuelDeps
  private readonly visuals: CardVisuals
  private readonly icons: DuelIcons
  /** 图标是自己烤的还是调用方给的。自己烤的才归自己销毁。 */
  private readonly ownsIcons: boolean
  /** 渲染器是自己建的还是挂在别人的上面（目录页那条路）。自己建的才归自己销毁。 */
  private readonly ownsRenderer: boolean
  private readonly clock = createSceneClock()
  private readonly ctx: DuelContext
  private layout: DuelLayout
  private parts: DuelParts
  private input: DuelInput
  private locks: DirectorLocks | null = null
  /** 上一帧的逐帧跟随（拖拽）还没收敛。它和补间账一起决定帧循环停不停。 */
  private interactionBusy = false
  /** 视图变过、还没兜底对账。对账只在队列播空、动画也停了那一刻跑。 */
  private dirty = false
  private destroyed = false
  private onCommandCb: ((command: DuelCommand) => void) | null = null
  private onUserActionCb: DuelContext['userAction'] | null = null
  private onTutorialCb: DuelContext['tutorial'] | null = null

  constructor(renderer: Renderer, options: DuelSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.options = options
    this.ownsRenderer = ownsRenderer
    this.layout = pickLayout(options.width, options.height, options.coarsePointer)
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
      wake: () => this.frameLoop.wake(),
    })
    this.visuals = createCardVisuals(options.catalog, options.textures)
    this.ownsIcons = options.icons === undefined
    this.icons = options.icons ?? bakePlaceholderIcons(renderer)
    this.parts = this.buildParts()
    this.ctx = this.makeContext()
    this.input = createDuelInput(this.ctx)
    this.applyStageHitArea()
    // 4.3：上下文丢了之后把「画出来的」纹理重画一遍。图片纹理 Pixi 自己会重传，这几张不会。
    options.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
  }

  private buildParts(): DuelParts {
    return createParts({
      stage: this.stage,
      renderer: this.renderer,
      deps: this.deps,
      layout: this.layout,
      icons: this.icons,
      onEndPlay: () => {
        this.onUserActionCb?.({ kind: 'end-play' })
        this.onCommandCb?.({ type: 'END_PLAY', player: this.options.seat })
      },
      onLeave: this.options.onLeave,
      onToggleMute: this.options.onToggleMute,
    })
  }

  /**
   * 组装上下文。`parts` 和 `layout` 走取值器：换档位会整套换掉零件、改视口会换掉版式，
   * 而 cue 播放器手里的这份上下文是同一个对象，取值器让它们始终看到当前那一份。
   */
  private makeContext(): DuelContext {
    const scene = this
    return {
      seat: this.options.seat,
      catalog: this.options.catalog,
      visuals: this.visuals,
      deps: this.deps,
      stage: this.stage,
      get parts() {
        return scene.parts
      },
      get layout() {
        return scene.layout
      },
      set layout(next: DuelLayout) {
        scene.layout = next
      },
      view: null,
      leaving: new Map(),
      pendingHand: [],
      pendingFoeDeal: 0,
      doomedTiles: new Set(),
      hiddenTiles: new Set(),
      handCardIds: new Map(),
      markKeys: new Map(),
      locks: new Set(),
      showcased: null,
      inspectingTile: null,

      makeCard: (cardId, instanceId) => this.makeCard(cardId, instanceId),
      makeHero: (heroId) => makeHeroArt(this.options.textures.heroes?.[heroId]),
      tilePoint: (instanceId) => tilePointOf(this.layout, this.parts.board, instanceId),
      cardIdOf: (instanceId) => this.cardIdOf(instanceId),
      after: (delayMs, run) => this.clock.after(delayMs, run),
      deckPose: () => deckPoseOf(this.layout),
      bindHandCard: (card) => this.input.bindCard(card),
      bindTile: (tile) => this.input.bindTile(tile),
      wake: () => this.frameLoop.wake(),
      userAction: (action) => this.onUserActionCb?.(action),
      command: (command) => this.onCommandCb?.(command),
      tutorial: (cue) => this.onTutorialCb?.(cue),
      beginHeroSkill: () => this.input.beginHeroSkill(),
      refreshLocks: () => this.refreshLocks(),
    }
  }

  private makeCard(cardId: CardId, instanceId: string): CardSprite {
    return new CardSprite(this.visuals.visualOf(cardId, instanceId), this.deps.cardDeps)
  }

  /** 场上（或手上）那个实例现在是哪张牌。 */
  private cardIdOf(instanceId: InstanceId): CardId | null {
    const view = this.ctx.view
    const onBoard =
      view === null
        ? undefined
        : (view.self.board.find((ai) => ai.instanceId === instanceId) ??
          view.opponent.board.find((ai) => ai.instanceId === instanceId))
    return onBoard?.cardId ?? this.ctx.handCardIds.get(instanceId) ?? null
  }

  private refreshLocks(): void {
    if (this.locks === null) return
    this.input.refresh(this.locks, this.ctx.locks.size > 0)
  }

  private applyStageHitArea(): void {
    this.stage.eventMode = 'static'
    this.stage.hitArea = new Rectangle(0, 0, this.layout.width, this.layout.height)
  }

  /** 把这一局用得上的纹理和文字全部先过一遍 GPU，理由见 warmup.ts。 */
  warmup(): void {
    warmupScene({
      renderer: this.renderer,
      stage: this.stage,
      // 挂在战场层：它在最底下，预热卡不会盖住别的层，而这时候场上本来也是空的。
      layer: this.parts.layers.board,
      // 只热这一局用得上的贴图：调用方按纪律 3.4 只加载了当前两副牌要的那些。
      visuals: Object.keys(this.options.textures.faces).map((cardId, index) =>
        this.visuals.visualOf(cardId, `warmup:${index}`),
      ),
      deps: this.deps.cardDeps,
      ring: this.parts.hitFx.ring,
      width: this.layout.width,
      height: this.layout.height,
    })
    this.render(0)
  }

  /** 推进一帧但不画：推虚拟时钟、播到点的 cue、推逐帧跟随、到点了和视图对一次账。 */
  private advance(deltaMs: number): boolean {
    this.clock.advance(deltaMs, (cue) => playCue(this.ctx, cue))
    this.interactionBusy = this.input.advance(deltaMs)
    // 演出播完、动画也停了，这才和视图对一次账（约定见 duelContract.ts 的文件头）。
    if (this.dirty && this.clock.isIdle() && !this.deps.animator.isBusy()) {
      this.dirty = false
      reconcile(this.ctx)
    }
    return !this.idle()
  }

  /** 一帧：推进，然后把画面交出去。自己管帧循环的那条路走这里。 */
  private render(deltaMs: number): void {
    this.advance(deltaMs)
    this.renderer.render(this.stage)
  }

  private idle(): boolean {
    return (
      this.clock.isIdle() && !this.deps.animator.isBusy() && !this.interactionBusy && !this.dirty
    )
  }

  handle(): DuelScene {
    return {
      applyView: (view) => {
        this.dirty = true
        applyView(this.ctx, view)
      },
      play: (cues) => {
        this.clock.enqueue(cues)
        this.frameLoop.wake()
      },
      setLocks: (locks) => {
        this.locks = locks
        this.refreshLocks()
      },
      onCommand: (callback) => {
        this.onCommandCb = callback
      },
      onUserAction: (callback) => {
        this.onUserActionCb = callback
      },
      onTutorialCue: (callback) => {
        this.onTutorialCb = callback
      },
      step: (deltaMs) => this.frameLoop.step(deltaMs),
      isIdle: () => this.idle(),
      counters: (): DuelSceneCounters => ({
        textCreated: this.deps.text.textCreated,
        ...this.frameLoop.counters(),
      }),
      resize: (width, height) => this.resize(width, height),
      reset: () => this.reset(),
      destroy: () => this.destroy(),
    }
  }

  mounted(): MountedDuelScene {
    return { ...this.handle(), root: this.stage, advance: (deltaMs) => this.advance(deltaMs) }
  }

  private resize(width: number, height: number): void {
    if (width === this.layout.width && height === this.layout.height) return
    const next = pickLayout(width, height, this.options.coarsePointer)
    this.renderer.resize(width, height)
    const switched = next.tier !== this.layout.tier
    this.layout = next
    this.applyStageHitArea()
    if (switched) this.rebuild()
    else applyPartsLayout(this.parts, this.layout)
    this.frameLoop.wake()
  }

  /**
   * 换档位：两档版式的零件表本身不一样（侧栏在手机档整个没有），只能重建。
   * 重建完把最后一份视图重新摆一遍并立刻对账——换档位是玩家转了个屏，不该补演一段动画。
   */
  private rebuild(): void {
    const view = this.ctx.view
    this.clear()
    this.input.destroy()
    for (const child of this.stage.removeChildren()) child.destroy({ children: true })
    this.parts = this.buildParts()
    this.input = createDuelInput(this.ctx)
    if (view !== null) {
      applyView(this.ctx, view)
      reconcile(this.ctx)
      this.dirty = false
    }
    this.refreshLocks()
  }

  /** 把这一局在画面上留下的东西全部清掉。换一局和换档位共用。 */
  private clear(): void {
    this.clock.reset()
    this.input.cancelTargeting()
    clearScene(this.ctx)
    this.dirty = false
  }

  private reset(): void {
    this.clear()
    this.ctx.view = null
    this.frameLoop.wake()
  }

  private readonly onContextRestored = (): void => {
    restoreDeps(this.deps)
    this.frameLoop.wake()
  }

  /**
   * 拆场景。调第二次直接返回——Pixi 的 `renderer.destroy()` 会把内部几个系统的表置成 null，
   * 第二次进去就在 null 上取属性，当场抛 TypeError。契约里只说了 destroy，
   * 没说「只许调一次」，所以由这里兜住（开发页的 effect 清理很容易写成拆两次）。
   */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.options.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.input.destroy()
    this.clear()
    /*
     * 顺序要紧：**先掐补间，再还 GSAP 的时钟**。
     *
     * 还时钟那一下是同步跑一帧的（见 frameLoop 的 releaseGsapRoot），喂进去的时刻比
     * 我们手动推到的位置靠后几十秒，于是还活着的补间会被一口气演到终点。
     * 而上面的 clear() 刚刚清过场——那一帧要是写到已经销毁的对象上就当场抛 TypeError。
     * 反过来也不行：clear() 自己要靠 animator 掐补间，所以它必须排在最前面。
     */
    destroyDeps(this.deps)
    this.frameLoop.destroy()
    if (this.ownsIcons) for (const icon of Object.values(this.icons)) icon.destroy(true)
    // 只销毁场景自己建的东西：调用方传进来的卡面纹理不归我们管（谁加载谁负责）。
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
