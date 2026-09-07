/**
 * 对局原型场景：发牌、手牌扇形、拖出出牌、翻面、落地命中特效。
 * 对应《正式版架构》迁移第 1 条，同时是 `packages/bench` 打分用的那段剧本的舞台。
 *
 * 契约的几条硬要求都落在这个文件里：
 * - 显式走 WebGL，不开 WebGPU（3.8）——见 autoDetectRenderer 的 preference。
 * - 手动时钟下不注册任何真实时间源，只认 step()；真实时钟下没有动画就停帧循环（3.6）。
 * - 所有随机数走定种子的 Rng（6.9 的确定性前提）。
 * - 纹理由调用方加载好传进来，场景不管资源从哪来（第 2 节第 5 条，平台能力以后走 platform 包）。
 * - 上下文丢失时把烤出来的纹理重画一遍（4.3）。
 *
 * 层级（自下而上）：战场 → 特效 → 手牌扇形 → 拖拽层。
 * 震屏抖的是 worldRoot，也就是这四层一起抖，和旧版抖 `.battle` 根元素是同一个口径。
 */

import { tokens } from '@ai-duel/design'
import { autoDetectRenderer, Container, Rectangle, type Renderer } from 'pixi.js'
import { CardSprite, type CardSpriteDeps } from '../components/CardSprite'
import { CardTilt } from '../components/cardTilt'
import { applyPose, HandFan } from '../components/HandFan'
import { type BakedTextures, bakeTextures } from '../fx/bakedTextures'
import { TIER_CONFIG } from '../fx/effectTier'
import { HitFx } from '../fx/HitFx'
import { HandPointer } from '../interaction/handPointer'
import { CARD_HEIGHT, CARD_WIDTH, LAYOUT_DUR, PLAYER_FAN } from '../layout/fanMath'
import { DEAL_STAGGER } from '../layout/handLayout'
import { Animator } from '../runtime/animator'
import { FrameLoop } from '../runtime/frameLoop'
import { Rng } from '../runtime/rng'
import { TextTextureCache } from '../runtime/textCache'
import { cardVisualOf } from './deckCards'
import type { DuelPrototype, DuelPrototypeOptions } from './duelContract'
import { computeLayout, type DuelLayout, fanToWorld, toFanLocal } from './duelLayout'
import { warmupScene } from './warmup'

/** 卡牌从手上飞到战场落点的时长和缓动，抄自旧客户端 MatchStage 里那段 Flip 飞行。 */
const FLIGHT_DUR = 0.65
const FLIGHT_EASE = 'power2.inOut'
/** 翻面时长，抄自旧客户端 HandFan 里问号翻面那一下。 */
const FLIP_DUR = 0.4
/** 合成出牌时"从抬起到越过出牌线"这一段的时长，对应真拖拽里玩家把牌拽上去的那一下。 */
const SYNTHETIC_DRAG_DUR = 0.28

export async function createDuelPrototype(opts: DuelPrototypeOptions): Promise<DuelPrototype> {
  const renderer = await autoDetectRenderer({
    canvas: opts.canvas,
    width: opts.width,
    height: opts.height,
    resolution: opts.resolution,
    // 3.8：显式走 WebGL。数组形式是排除式的——WebGPU 不在名单里就整个不试。
    preference: ['webgl'],
    antialias: true,
    // 让 Pixi 顺手把 canvas 的 CSS 尺寸设成逻辑像素，画布分辨率才和 resolution 对得上。
    autoDensity: true,
    background: tokens.color.page.background,
  })

  const state = new DuelScene(renderer, opts)
  state.warmup()
  return state.handle()
}

/** 场景的全部可变状态。拆成类只是为了让下面那堆闭包有个明确的家，它不对外导出。 */
class DuelScene {
  private readonly renderer: Renderer
  private readonly opts: DuelPrototypeOptions
  private readonly stage = new Container()
  private readonly worldRoot = new Container()
  private readonly boardLayer = new Container()
  private readonly fxLayer = new Container()
  private readonly dragLayer = new Container()
  private readonly fan: HandFan
  private readonly pointer: HandPointer
  private readonly animator: Animator
  private readonly frameLoop: FrameLoop
  private readonly text: TextTextureCache
  private readonly baked: BakedTextures
  private readonly hitFx: HitFx
  private readonly rng: Rng
  /** 建卡要的那几样东西。预热和发牌共用同一份，两条路建出来的卡才是一样的。 */
  private readonly cardDeps: CardSpriteDeps
  private readonly tilts = new Map<string, CardTilt>()
  private layout: DuelLayout
  /** 牌库里下一张要发的是第几张，也是卡牌实例编号的来源。 */
  private drawn = 0
  /** 战场上已经落了几张，决定下一张落哪个格子。 */
  private landed = 0
  /** 演出期间整排手牌冻住：牌还在半空飞就能被拖走的话，画面会乱成一团。 */
  private frozen = false
  /** 上一帧的逐帧跟随（拖拽、倾斜）还没收敛。它和补间账一起决定帧循环停不停。 */
  private interactionBusy = false
  /** 已经拆过了。见 destroy 里那段注释。 */
  private destroyed = false

  constructor(renderer: Renderer, opts: DuelPrototypeOptions) {
    this.renderer = renderer
    this.opts = opts
    this.rng = new Rng(opts.seed)
    this.layout = computeLayout(opts.width, opts.height)

    this.stage.addChild(this.worldRoot)
    this.worldRoot.addChild(this.boardLayer, this.fxLayer)
    // 特效层和战场层都不吃指针事件：它们只是画面，挡住手牌就没法出牌了。
    this.boardLayer.eventMode = 'none'
    this.fxLayer.eventMode = 'none'

    this.text = new TextTextureCache(renderer)
    this.baked = bakeTextures(renderer)
    this.cardDeps = {
      baked: this.baked,
      text: this.text,
      glare: TIER_CONFIG[opts.tier].glare,
    }

    this.animator = new Animator(() => this.frameLoop?.wake())
    this.frameLoop = new FrameLoop({
      manual: opts.manualClock,
      render: (delta) => this.render(delta),
      isBusy: () => this.animator.isBusy() || this.interactionBusy,
    })

    this.fan = new HandFan({
      animator: this.animator,
      geometry: PLAYER_FAN,
      areaWidth: this.layout.fanAreaWidth,
    })
    this.worldRoot.addChild(this.fan, this.dragLayer)

    this.hitFx = new HitFx({
      layer: this.fxLayer,
      shakeTarget: this.worldRoot,
      animator: this.animator,
      baked: this.baked,
      rng: this.rng,
      tier: opts.tier,
    })

    this.pointer = new HandPointer({
      stage: this.stage,
      fan: this.fan,
      dragLayer: this.dragLayer,
      animator: this.animator,
      dropZone: () => this.layout.dropZone,
      toFanLocal: (x, y) => toFanLocal(this.layout, x, y),
      fanToWorld: (x, y, scale) => fanToWorld(this.layout, x, y, scale),
      tiltFor: (card) => this.tilts.get(card.cardId),
      onPlay: (card) => void this.flyToBoard(card),
      enabled: () => !this.frozen,
      wake: () => this.frameLoop.wake(),
    })

    this.applyLayout()
    // 4.3：上下文丢了之后把"画出来的"纹理重画一遍。图片纹理 Pixi 自己会重传，这几张不会。
    opts.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
  }

  handle(): DuelPrototype {
    return {
      deal: (count) => this.deal(count),
      playCard: (index) => this.playCard(index),
      flip: (index) => this.flip(index),
      hover: (index, at) => this.hover(index, at),
      step: (delta) => this.frameLoop.step(delta),
      isIdle: () => !this.animator.isBusy() && !this.interactionBusy,
      counters: () => ({
        textCreated: this.text.textCreated,
        ...this.frameLoop.counters(),
      }),
      resize: (width, height) => this.resize(width, height),
      destroy: () => this.destroy(),
    }
  }

  /**
   * 把这一局要用的纹理和文字全部先过一遍 GPU，理由见 warmup.ts。
   * 建完场景就跑，剧本和玩家的第一帧之前一定已经做完。
   */
  warmup(): void {
    warmupScene({
      renderer: this.renderer,
      stage: this.stage,
      // 挂在战场层：它在最底下，预热卡不会盖住别的层，而这时候场上本来也是空的。
      layer: this.boardLayer,
      deck: this.opts.deck,
      textures: this.opts.textures,
      deps: this.cardDeps,
      width: this.layout.width,
      height: this.layout.height,
    })
    this.render(0)
  }

  /** 一帧：先把逐帧跟随推一步，再把画面交出去。补间的时间已经由帧循环推过了。 */
  render(deltaMs: number): void {
    let busy = this.pointer.advance(deltaMs)
    for (const tilt of this.tilts.values()) {
      if (tilt.advance(deltaMs)) busy = true
    }
    this.interactionBusy = busy
    this.renderer.render(this.stage)
  }

  /**
   * 抬牌，可选地连指针位置一起喂进去（契约见 duelContract.ts）。
   *
   * 给了位置就走和真指针完全一样的那条路：同一个 CardTilt.setPointer，
   * 所以倾斜的角度、反光的光心、收敛的节奏都和玩家真拿鼠标扫过时一模一样
   * （真指针那条在 interaction/handPointer.ts 的 setPointerTilt，它只多做一步坐标换算）。
   * 换手时先给上一张 release()，否则那张的倾斜会僵在离手时的角度上——真指针那边
   * 由 onOver 负责这件事。
   */
  private hover(handIndex: number | null, at?: { rx: number; ry: number }): void {
    const previous = this.fan.hovered
    if (previous >= 0 && previous !== handIndex) {
      const gone = this.fan.laid()[previous]
      if (gone !== undefined) this.tilts.get(gone.cardId)?.release()
    }
    this.fan.setHover(handIndex ?? -1)
    if (handIndex !== null && at !== undefined) {
      const card = this.fan.laid()[handIndex]
      if (card !== undefined) this.tilts.get(card.cardId)?.setPointer(at.rx, at.ry)
    }
    // 倾斜和反光是逐帧收敛的，没有补间替它们叫醒帧循环，得自己叫（同 handPointer 的 wake）。
    this.frameLoop.wake()
  }

  private async deal(count: number): Promise<void> {
    const from = this.deckPose()
    const delays = new Map<string, number>()
    for (let i = 0; i < count; i += 1) {
      const card = this.makeCard()
      if (card === null) break
      this.fan.insert(card, from)
      this.pointer.bind(card)
      delays.set(card.cardId, i * DEAL_STAGGER)
    }
    this.fan.layout('reflow', delays)
    // 最后一张的延迟加上一次重排的时长，就是整段发牌演完的时刻。
    return this.wait(Math.max(0, count - 1) * DEAL_STAGGER + LAYOUT_DUR)
  }

  /**
   * 合成一段拖拽出牌。
   *
   * 和真指针拖拽共用后半段（flyToBoard）：抬起、转正放大、越过出牌线这三步在这儿按脚本演，
   * 之后交给同一个落地流程，两条路的落地手感因此永远一致。
   * 前半段没法真的重放指针事件——那要跨好几帧喂坐标，而这个函数必须一次把演出排完。
   */
  private async playCard(handIndex: number): Promise<void> {
    const card = this.fan.laid()[handIndex]
    if (card === undefined) return
    this.frozen = true
    this.fan.setHover(handIndex)

    const world = fanToWorld(this.layout, card.x, card.y, card.scale.x)
    this.fan.detach(card)
    this.animator.killTweensOf(card)
    this.animator.killTweensOf(card.scale)
    this.dragLayer.addChild(card)
    applyPose(card, { x: world.x, y: world.y, rotation: 0, scale: world.scale })

    // 拖到出牌区正中：那是"越过出牌线"的最短确定路径，和玩家把牌拽进战场是同一个终点。
    const zone = this.layout.dropZone
    const { timeline, done } = this.animator.timelineAsync()
    timeline.to(
      card,
      {
        x: zone.x + zone.width / 2,
        y: zone.y + zone.height * 0.8,
        duration: SYNTHETIC_DRAG_DUR,
        ease: 'power2.out',
      },
      0,
    )
    timeline.to(card.scale, { x: 1.1, y: 1.1, duration: SYNTHETIC_DRAG_DUR, ease: 'power2.out' }, 0)
    await done
    await this.flyToBoard(card)
  }

  /**
   * 牌落到战场：飞过去、缩到战场尺寸、落地播命中特效，手牌同时合拢。
   * 真拖拽松手和合成出牌都走这里，两条路的落地手感必须一致。
   */
  private async flyToBoard(card: CardSprite): Promise<void> {
    this.frozen = true
    const slot = this.layout.boardSlots[this.landed % this.layout.boardSlots.length]
    const target = slot ?? { x: this.layout.width / 2, y: this.layout.height / 2 }
    this.landed += 1

    // 牌可能还挂在扇形容器上（真拖拽松手那条路），先统一挪到拖拽层，坐标才是视口坐标。
    if (card.parent !== this.dragLayer) {
      const world = fanToWorld(this.layout, card.x, card.y, card.scale.x)
      this.dragLayer.addChild(card)
      applyPose(card, { x: world.x, y: world.y, rotation: 0, scale: world.scale })
    }
    this.fan.remove(card)
    this.tilts.get(card.cardId)?.reset()
    this.tilts.delete(card.cardId)

    const boardScale = this.layout.boardScale
    const { timeline, done } = this.animator.timelineAsync()
    timeline.to(
      card,
      {
        x: target.x,
        // 落点给的是格子中心，而卡的原点在底边中点，所以要往下补半张卡。
        y: target.y + (CARD_HEIGHT * boardScale) / 2,
        rotation: 0,
        duration: FLIGHT_DUR,
        ease: FLIGHT_EASE,
      },
      0,
    )
    timeline.to(
      card.scale,
      { x: boardScale, y: boardScale, duration: FLIGHT_DUR, ease: FLIGHT_EASE },
      0,
    )
    await done

    // 落地：把牌交给战场层，然后播特效。特效层在战场之上，烟尘才盖得住卡的下沿。
    this.boardLayer.addChild(card)
    card.eventMode = 'none'
    const tail = this.hitFx.play({
      x: target.x,
      y: target.y,
      width: CARD_WIDTH * boardScale,
      height: CARD_HEIGHT * boardScale,
    })
    await this.wait(tail)
    this.frozen = false
  }

  private async flip(handIndex: number): Promise<void> {
    const card = this.fan.laid()[handIndex]
    if (card === undefined) return
    const to = card.isFacingBack() ? 0 : 180
    const { timeline, done } = this.animator.timelineAsync()
    timeline.to(card.flipState, {
      angle: to,
      duration: FLIP_DUR,
      ease: 'power2.inOut',
      overwrite: 'auto',
      onUpdate: () => card.setFlipAngle(card.flipState.angle),
    })
    return done
  }

  private resize(width: number, height: number): void {
    if (width === this.layout.width && height === this.layout.height) return
    this.layout = computeLayout(width, height)
    this.renderer.resize(width, height)
    this.stage.hitArea = new Rectangle(0, 0, width, height)
    this.applyLayout()
    this.frameLoop.wake()
  }

  private applyLayout(): void {
    const layout = this.layout
    this.stage.eventMode = 'static'
    this.stage.hitArea = new Rectangle(0, 0, layout.width, layout.height)
    this.fan.position.set(layout.handOrigin.x, layout.handOrigin.y)
    this.fan.scale.set(layout.handScale)
    this.fan.setAreaWidth(layout.fanAreaWidth)
  }

  /** 建一张新卡。牌库发完就返回 null。 */
  private makeCard(): CardSprite | null {
    const key = this.opts.deck[this.drawn % Math.max(1, this.opts.deck.length)]
    if (key === undefined) return null
    const face = this.opts.textures.faces[key]
    if (face === undefined) return null
    const visual = cardVisualOf(key, this.drawn, face, this.opts.textures.back)
    this.drawn += 1
    const card = new CardSprite(visual, this.cardDeps)
    this.tilts.set(card.cardId, new CardTilt(card, TIER_CONFIG[this.opts.tier].cardTilt))
    return card
  }

  /** 牌库那摞牌此刻的姿态，换算到手牌容器的坐标系里——发牌就是从这个姿态起飞的。 */
  private deckPose(): { x: number; y: number; rotation: number; scale: number } {
    const deck = this.layout.deck
    const local = toFanLocal(this.layout, deck.x, deck.y)
    // 牌库上的牌是正着摞的，扇形的倾角留给飞行途中转出来。
    return { x: local.x, y: local.y, rotation: 0, scale: deck.scale / this.layout.handScale }
  }

  /**
   * 等一段时间。走的是同一条补间时间线，所以手动时钟下它也归 step() 推，
   * 不会因为用了 setTimeout 而在固定步进的剧本里跑飞。
   *
   * 补的是一个用完就扔的代理对象而不是空对象：GSAP 的补间要有一个真在变的属性，
   * 一个属性都没有的话它拿不到时长该挂在谁身上。
   */
  private wait(seconds: number): Promise<void> {
    if (seconds <= 0) return Promise.resolve()
    const { timeline, done } = this.animator.timelineAsync()
    timeline.to({ t: 0 }, { t: 1, duration: seconds })
    return done
  }

  private readonly onContextRestored = (): void => {
    this.baked.restore()
    this.text.restore()
    this.frameLoop.wake()
  }

  /**
   * 拆场景。调第二次直接返回。
   *
   * 挡重复调用不是洁癖：Pixi 的 `renderer.destroy()` 会把内部几个系统的表置成 null，
   * 第二次进去就在 null 上取属性，当场抛 TypeError。而调用方多半是 React——
   * 它的 effect 清理很容易写成"句柄和 ref 各拆一次"，那种错在开发模式下表现为整页白屏
   * （异常从 effect 清理里冒出来，组件被卸载），排查起来完全看不出和画布有关。
   * 契约里只说了「destroy」，没说「只许调一次」，所以由这里兜住。
   */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.opts.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.pointer.destroy()
    this.animator.destroy()
    this.frameLoop.destroy()
    this.baked.destroy()
    this.text.destroy()
    // 只销毁场景自己建的东西：调用方传进来的卡面纹理不归我们管（谁加载谁负责）。
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    this.renderer.destroy()
  }
}
