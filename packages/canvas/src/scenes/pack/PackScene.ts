/**
 * 开包渲染器（迁移第 29 条）：卡背居中 → 点一下翻面 → 一记命中特效 → 报卡名 → 「继续」。
 *
 * 最小版，理由见 packContract.ts：旧版根本没有这个界面，卡池扩容之前它也开不出牌来。
 * 所以这里不做「一次开五包」「稀有度光效」那一套——那是有东西可开之后才谈得上的设计。
 *
 * 翻面走 `CardSprite` 自己的 `flipState`（真透视，转过 90° 那一刻正反面硬切），
 * 时长取对局里那条 `PLAY_FLIP_MS`：同一个动作在两处该是同一个节奏。
 * 翻到底的那一刻放一记 `HitFx`——它本来是「牌砸到战场上」的特效，用在这里正好：
 * 新卡是「落进」收藏的。
 */

import { Container, Graphics, type Renderer } from 'pixi.js'
import { Box, type BoxDeps, CANVAS_BACKGROUND } from '../../components/Box'
import { CardSprite } from '../../components/CardSprite'
import { PLAY_FLIP_MS } from '../../director/timings'
import { bakeTextures } from '../../fx/bakedTextures'
import { HitFx } from '../../fx/HitFx'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import { Animator } from '../../runtime/animator'
import { killAndDestroy } from '../../runtime/dispose'
import { FrameLoop } from '../../runtime/frameLoop'
import { Rng } from '../../runtime/rng'
import { createSceneRenderer } from '../../runtime/sceneRenderer'
import { TextTextureCache } from '../../runtime/textCache'
import { pickTier } from '../duel/layout/pickLayout'
import type { PackAction, PackScene, PackSceneOptions, PackView } from './packContract'

/** 卡在视口里占多高（两档各一个比例）。窄屏上要留出下面那几块方块的位置。 */
const CARD_HEIGHT_RATIO = { desktop: 0.52, mobile: 0.42 }

/** 卡底下那一摞方块：宽占视口宽几成、最窄最宽多少、行高、行距、离卡底多远。 */
const COLUMN = { widthRatio: 0.6, minWidth: 160, maxWidth: 320, height: 44, gap: 12, top: 24 }

export async function createPackScene(options: PackSceneOptions): Promise<PackScene> {
  const renderer = await createSceneRenderer(options)
  return new PackSceneImpl(renderer, options, true).handle()
}

/** 挂在别人的渲染器上的开包页（组件目录页那条路，理由同 mountRoomScene）。 */
export interface MountedPackScene extends PackScene {
  readonly root: Container
  /** 推进一帧但**不**渲染——渲染归外面那套帧循环。返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
}

export function mountPackScene(renderer: Renderer, options: PackSceneOptions): MountedPackScene {
  return new PackSceneImpl(renderer, options, false).mounted()
}

class PackSceneImpl {
  private readonly renderer: Renderer
  private readonly stage = new Container()
  private readonly world = new Container()
  private readonly fxLayer = new Container()
  private readonly chrome = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: BoxDeps & { baked: ReturnType<typeof bakeTextures>; animator: Animator }
  /** 垫在最底下那块浅灰，理由同 RoomScene 的 backdrop（见 Box.ts 的 CANVAS_BACKGROUND）。 */
  private readonly backdrop = new Graphics()
  private readonly hitFx: HitFx
  private readonly options: PackSceneOptions
  private readonly ownsRenderer: boolean
  private viewport: { width: number; height: number }
  private card: CardSprite | null = null
  private view: PackView | null = null
  private onAction: ((action: PackAction) => void) | null = null
  private destroyed = false

  constructor(renderer: Renderer, options: PackSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.options = options
    this.ownsRenderer = ownsRenderer
    this.viewport = { width: options.width, height: options.height }
    this.frameLoop = new FrameLoop({
      manual: options.manualClock === true,
      render: () => this.render(),
      isBusy: () => !this.idle(),
    })
    const baked = bakeTextures(renderer)
    this.deps = {
      baked,
      text: new TextTextureCache(renderer),
      animator: new Animator(() => this.frameLoop.wake()),
    }
    this.hitFx = new HitFx({
      layer: this.fxLayer,
      // 震屏抖的是整个世界层，不是舞台：舞台上还挂着特效层，一起抖就看不出是"屏幕在抖"。
      shakeTarget: this.world,
      animator: this.deps.animator,
      baked,
      rng: new Rng(options.seed ?? 1),
      tier: options.tier ?? 'mid',
    })
    this.stage.addChild(this.backdrop, this.world, this.fxLayer, this.chrome)
    this.paintBackdrop()
  }

  private paintBackdrop(): void {
    this.backdrop
      .clear()
      .rect(0, 0, this.viewport.width, this.viewport.height)
      .fill({ color: CANVAS_BACKGROUND })
  }

  private get tier(): 'desktop' | 'mobile' {
    return pickTier(this.viewport.width, this.viewport.height, this.options.coarsePointer === true)
  }

  /** 卡的缩放：按视口高占几成算，再折算成相对卡面基准高的倍数。 */
  private cardScale(): number {
    return (this.viewport.height * CARD_HEIGHT_RATIO[this.tier]) / CARD_HEIGHT
  }

  private setView(view: PackView): void {
    const before = this.view
    this.view = view
    // 只有换了牌才重建：翻面那一步也是调这个方法，重建会把正在播的翻面掐掉。
    // 牌的身份看 instanceId（CardVisual 的实例标识），不是卡牌 id。
    if (before === null || before.card.instanceId !== view.card.instanceId) {
      this.rebuild(view)
      return
    }
    if (before.phase !== view.phase) this.applyPhase(view.phase, true)
  }

  /** 换一张牌（或第一次摆）：整套重建，然后按当前这一步摆好，不播翻面。 */
  private rebuild(view: PackView): void {
    if (this.card !== null) killAndDestroy(this.deps.animator, this.card)
    this.world.removeChildren()
    const card = new CardSprite(view.card, {
      baked: this.deps.baked,
      text: this.deps.text,
      // 这一页只有一张卡、也没有指针跟随，反光建了也永远不会亮。
      glare: false,
      // 就一张卡，投影照画：开包那一下卡是"浮"在页面上的，没有影子会显得贴在底板上。
      shadow: true,
    })
    card.eventMode = 'static'
    card.cursor = 'pointer'
    card.on('pointertap', () => {
      if (this.view?.phase === 'closed') this.onAction?.({ kind: 'flip' })
    })
    // 开包那一下卡是浮在页面中央的，投影开着（见 CardSprite.setLifted）。
    card.setLifted(true)
    this.card = card
    this.world.addChild(card)
    this.place()
    this.applyPhase(view.phase, false)
  }

  /**
   * 摆到某一步。
   *
   * @param animate 播不播翻面。第一次摆（或换牌）时直接摆到位——那时候玩家还没点过，
   *   播一段翻面等于凭空翻给他看。
   */
  private applyPhase(phase: PackView['phase'], animate: boolean): void {
    const card = this.card
    if (card === null) return
    const target = phase === 'closed' ? 180 : 0
    if (!animate) {
      card.flipState.angle = target
      card.setFlipAngle(target)
      this.buildChrome()
      return
    }
    this.deps.animator.tween(card.flipState, {
      angle: target,
      duration: PLAY_FLIP_MS / 1000,
      ease: 'power2.inOut',
      overwrite: 'auto',
      onUpdate: () => card.setFlipAngle(card.flipState.angle),
      onComplete: () => {
        // 翻到底才放特效和那行字：翻的过程中卡还是侧着的，字先出来会抢戏。
        this.playHit()
        this.buildChrome()
      },
    })
  }

  private playHit(): void {
    const card = this.card
    if (card === null) return
    const scale = this.cardScale()
    this.hitFx.play({
      x: card.x,
      // 卡的原点在底边中点，特效要的是**中心**，所以往上提半张卡。
      y: card.y - (CARD_HEIGHT * scale) / 2,
      width: CARD_WIDTH * scale,
      height: CARD_HEIGHT * scale,
    })
  }

  /** 卡摆在视口正中偏上，给下面那三行留位置。 */
  private place(): void {
    const card = this.card
    if (card === null) return
    const scale = this.cardScale()
    card.scale.set(scale)
    const cardHeight = CARD_HEIGHT * scale
    const top = this.viewport.height * 0.12
    card.position.set(this.viewport.width / 2, top + cardHeight)
  }

  /**
   * 卡底下那一摞方块。每换一步整层重建（这一页一辈子只重建两三次）。
   *
   * 还没翻开时只有一句「点一下翻开」；翻开之后是卡名、「已加入收藏」和「继续」三块。
   */
  private buildChrome(): void {
    for (const child of this.chrome.removeChildren()) killAndDestroy(this.deps.animator, child)
    const view = this.view
    const card = this.card
    if (view === null || card === null) return
    const { height, width } = this.viewport
    const boxWidth = Math.min(
      COLUMN.maxWidth,
      Math.max(COLUMN.minWidth, Math.min(width - 32, width * COLUMN.widthRatio)),
    )
    const x = (width - boxWidth) / 2
    let y = Math.min(card.y + COLUMN.top, height - COLUMN.height)

    const add = (label: string, press?: () => void): void => {
      const box = new Box({ width: boxWidth, height: COLUMN.height, label }, this.deps)
      box.position.set(x, y)
      if (press !== undefined) box.onPress(press)
      this.chrome.addChild(box)
      y += COLUMN.height + COLUMN.gap
    }

    if (view.phase === 'closed') {
      add('点一下翻开')
      return
    }
    add(view.card.name)
    add('已加入收藏')
    add('继续', () => this.onAction?.({ kind: 'continue' }))
  }

  private render(): void {
    this.renderer.render(this.stage)
  }

  private idle(): boolean {
    return !this.deps.animator.isBusy()
  }

  /** 摆完新东西立刻画一帧，理由同 RoomScene 的 `paint`（不画这一帧按钮点不中）。 */
  private paint(): void {
    this.frameLoop.wake()
    if (this.ownsRenderer) this.renderer.render(this.stage)
  }

  handle(): PackScene {
    return {
      setView: (view: PackView) => {
        this.setView(view)
        this.paint()
      },
      onAction: (callback: (action: PackAction) => void) => {
        this.onAction = callback
      },
      step: (deltaMs) => this.frameLoop.step(deltaMs),
      isIdle: () => this.idle(),
      resize: (width, height) => this.resize(width, height),
      destroy: () => this.destroy(),
    }
  }

  mounted(): MountedPackScene {
    return { ...this.handle(), root: this.stage, advance: () => !this.idle() }
  }

  private resize(width: number, height: number): void {
    if (width === this.viewport.width && height === this.viewport.height) return
    this.viewport = { width, height }
    this.renderer.resize(width, height)
    this.paintBackdrop()
    this.place()
    this.buildChrome()
    this.paint()
  }

  /** 拆场景。调第二次直接返回（同 DuelScene / RoomScene 的理由）。 */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    // 顺序要紧：先掐补间，再还 GSAP 的时钟（同 DuelScene 的 destroy）。
    this.deps.animator.destroy()
    this.frameLoop.destroy()
    this.deps.baked.destroy()
    this.deps.text.destroy()
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
