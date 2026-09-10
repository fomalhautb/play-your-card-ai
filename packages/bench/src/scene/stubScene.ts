/**
 * 桩场景：几十个 Pixi 精灵，按 contract.ts 的契约实现。
 *
 * 它不是游戏的一部分，是测量骨架的**固定物**：真实场景（迁移第 1 条）还在同事手里的时候，
 * 用它来验证计数器、剧本、阈值这一整套东西自己是对的。它刻意做到每条计数器都会动——
 * 多张不同纹理（数纹理切换）、叠加混合的粒子（数混合切换）、文字对象（数文字重建）、
 * 高档位的全屏发光（数过度绘制）。
 *
 * 真实场景接上之后这个文件留着：骨架自身有回归时，桩场景是唯一不会跟着一起变的对照组。
 * 它按 `BenchScene` 那三个动作实现，但只求「形状对得上、每条计数器都会动」——
 * 它演的不是这个游戏，所以「放大查看」在这里就是把卡压扁再弹回来。
 */

import { tokens } from '@ai-duel/design'
import { gsap } from 'gsap'
import { Container, type Sprite, Ticker, WebGLRenderer } from 'pixi.js'
import type { BenchScene, BenchSceneOptions, DuelSceneCounters } from './contract'
import { mulberry32 } from './random'
import { configureGsap } from './stubGsap'
import { boardSlot, deckAnchor, fanSlot } from './stubLayout'
import type { CardView } from './stubProps'
import { buildStubProps } from './stubProps'

type Vars = Record<string, unknown> & { duration: number }

/** `restart` 摆几张手牌。够 `play10` 连着打十次还剩两张。 */
const RESTART_HAND = 12

class StubScene implements BenchScene {
  private readonly stage = new Container()
  private readonly cardLayer = new Container()
  private readonly fxLayer = new Container()
  private readonly ticker = new Ticker()
  private readonly pool: CardView[]
  private readonly particles: Sprite[]
  private readonly random: () => number
  private readonly glow: Sprite | null
  private hand: CardView[] = []
  private board: CardView[] = []
  private dealt = 0
  private elapsedMs = 0
  private active = 0
  private dirty = false
  private hovered: number | null = null
  private textCreated = 0
  private renders = 0
  private frameRequests = 0

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly opts: BenchSceneOptions,
  ) {
    this.random = mulberry32(opts.seed)
    // 固定物在 stubProps.ts 里造好，这里只负责挂进各自的层。
    const props = buildStubProps(opts)
    this.pool = props.cards
    this.particles = props.particles
    this.glow = props.glow
    // 每张卡带一个 Text，全在建卡池那一下烤好。这条计数器从这个数起步，
    // 之后再动就说明运行期又建了文字——纪律 3.5 要拦的正是那种情况。
    this.textCreated = props.cards.length
    this.cardLayer.addChild(...props.cards.map((card) => card.root))
    this.fxLayer.addChild(...props.particles)
    if (props.glow) this.fxLayer.addChild(props.glow)
    this.stage.addChild(props.background, this.cardLayer, this.fxLayer)
    if (!opts.manualClock) this.ticker.add(this.tick)
  }

  /**
   * 预热：把每张纹理、每种混合模式都渲染一遍，逼 Pixi 现在就把纹理传上去、着色器编译掉。
   * 不预热的话这些事会发生在剧本第一帧，「动画期间纹理上传为 0」和
   * 「预热后着色器编译为 0」两条永远过不了——而它们真正要拦的是运行期才发生的上传和编译。
   */
  warmup() {
    this.pool.forEach((card, i) => {
      card.root.visible = true
      card.root.x = 40 + (i % 12) * 90
      card.root.y = 120 + Math.floor(i / 12) * 200
    })
    for (const particle of this.particles) particle.visible = true
    if (this.glow) this.glow.visible = true
    this.render()

    for (const card of this.pool) card.face.texture = this.opts.textures.back
    this.render()

    for (const card of this.pool) {
      card.face.texture = this.opts.textures.faces[card.key] ?? this.opts.textures.back
      card.root.visible = false
    }
    for (const particle of this.particles) particle.visible = false
    if (this.glow) this.glow.visible = false
    this.render()
    if (this.opts.manualClock) {
      // 池子建完再清一次根时间轴：上一段剧本残留的补间会让这一段从半路开始。
      gsap.globalTimeline.clear()
      gsap.updateRoot(0)
    }
  }

  private render() {
    this.renderer.render(this.stage)
    this.renders += 1
    this.dirty = false
  }

  /** 有东西变了，需要一帧。真实时钟下顺手把帧循环叫醒。 */
  private markDirty() {
    this.dirty = true
    if (!this.opts.manualClock && !this.ticker.started) this.ticker.start()
  }

  /** 真实时钟下的帧回调。空闲就停掉帧循环，这正是纪律 3.6 要的行为。 */
  private readonly tick = () => {
    this.frameRequests += 1
    if (this.dirty) this.render()
    if (this.isIdle()) this.ticker.stop()
  }

  /** 包一层 gsap.to：登记在播动画的条数，并且每次 onUpdate 都把这一帧标脏。 */
  private tween(target: object, vars: Vars): Promise<void> {
    this.active += 1
    this.markDirty()
    return new Promise<void>((resolve) => {
      gsap.to(target, {
        ...vars,
        onUpdate: () => this.markDirty(),
        onComplete: () => {
          this.active -= 1
          this.markDirty()
          resolve()
        },
      })
    })
  }

  private layoutHand(): Promise<void>[] {
    const { width, height } = this.opts
    return this.hand.map((card, i) => {
      const slot = fanSlot(i, this.hand.length, width, height)
      return this.tween(card.root, {
        // 手牌重排的时长是有令牌的，抄自旧客户端的 fanMath.LAYOUT_DUR。
        duration: tokens.duration.hand.layout,
        x: slot.x,
        y: slot.y,
        rotation: slot.rotation,
        ease: 'power2.out',
      })
    })
  }

  /** 一批牌从卡堆飞进扇形。`restart` 用它把手牌摆好。 */
  private async deal(count: number): Promise<void> {
    const start = deckAnchor(this.opts.width, this.opts.height)
    for (let i = 0; i < count; i += 1) {
      const card = this.pool[this.dealt % this.pool.length]
      if (!card) break
      this.dealt += 1
      card.root.position.set(start.x, start.y)
      card.root.rotation = start.rotation
      card.root.scale.set(1)
      card.root.visible = true
      this.hand.push(card)
    }
    await Promise.all(this.layoutHand())
  }

  private async playCard(handIndex: number): Promise<void> {
    const card = this.hand[handIndex]
    if (!card) return
    this.hand.splice(handIndex, 1)
    this.board.push(card)
    const slot = boardSlot(this.board.length - 1, this.opts.width, this.opts.height)
    await Promise.all([
      this.tween(card.root, {
        duration: 0.3,
        x: slot.x,
        y: slot.y,
        rotation: 0,
        ease: 'power3.inOut',
      }),
      ...this.layoutHand(),
    ])
    await this.burst(slot.x, slot.y)
  }

  /** 命中特效：一圈叠加混合的粒子，高档位再盖一层全屏发光。 */
  private async burst(x: number, y: number): Promise<void> {
    const flying = this.particles.map((particle, i) => {
      const angle = (i / this.particles.length) * Math.PI * 2 + this.random()
      particle.visible = true
      particle.alpha = 1
      particle.position.set(x, y)
      return this.tween(particle, {
        duration: 0.25,
        x: x + Math.cos(angle) * 90,
        y: y + Math.sin(angle) * 90,
        alpha: 0,
        ease: 'power1.out',
      })
    })
    if (this.glow) {
      this.glow.visible = true
      this.glow.alpha = 0.35
      flying.push(this.tween(this.glow, { duration: 0.25, alpha: 0, ease: 'power1.out' }))
    }
    await Promise.all(flying)
    for (const particle of this.particles) particle.visible = false
    if (this.glow) this.glow.visible = false
    this.markDirty()
  }

  /** 桩场景版的「放大查看」：把卡压扁、换一面、再弹回来。它只负责让计数器动起来。 */
  async inspect(index: number): Promise<void> {
    const handIndex = index % Math.max(1, this.hand.length)
    const card = this.hand[handIndex]
    if (!card) return
    const showingBack = card.face.texture === this.opts.textures.back
    await this.tween(card.root.scale, { duration: 0.12, x: 0, ease: 'power2.in' })
    card.face.texture = showingBack
      ? (this.opts.textures.faces[card.key] ?? this.opts.textures.back)
      : this.opts.textures.back
    card.label.visible = showingBack
    await this.tween(card.root.scale, { duration: 0.12, x: 1, ease: 'power2.out' })
  }

  /**
   * 悬停不带动画：位置立刻变，只标一次脏。
   * 这条路径专门用来检验「没有补间但画面变了」时帧循环也会醒一帧再停。
   *
   * 契约第二个参数（指针在卡面上的位置）在这里收下就扔：桩场景的卡是几个纯色精灵，
   * 没有倾斜也没有反光可跟。它存在的意义是当测量骨架的固定物——数字不跟着真实场景变，
   * 所以它反而**不该**跟着真实场景一起加特效。
   */
  private hover(handIndex: number | null): void {
    const { width, height } = this.opts
    const restore = (index: number) => {
      const card = this.hand[index]
      if (card) card.root.y = fanSlot(index, this.hand.length, width, height).y
    }
    if (this.hovered !== null) restore(this.hovered)
    this.hovered = handIndex
    if (handIndex !== null) {
      const card = this.hand[handIndex]
      if (card) card.root.y = fanSlot(handIndex, this.hand.length, width, height).y - 28
    }
    this.markDirty()
  }

  /** 回到空场再摆一手牌。剧本每一段的热身和被测那遍各调一次。 */
  async restart(): Promise<void> {
    for (const card of this.pool) card.root.visible = false
    this.hand = []
    this.board = []
    this.dealt = 0
    this.hovered = null
    await this.deal(RESTART_HAND)
  }

  /** 连着打 n 张。每张之前先扫一眼手牌——那条路专门验证「没有补间但画面变了」也会醒一帧。 */
  async playCards(count: number): Promise<void> {
    for (let i = 0; i < count && this.hand.length > 0; i += 1) {
      this.hover(0)
      this.hover(null)
      await this.playCard(0)
    }
  }

  /** 桩场景没有结算层，这一段对它就是"再打两张"，只为让契约齐全。 */
  async settleRound(): Promise<void> {
    await this.playCards(2)
  }

  /** 桩场景没有文字要热身，这一档对它没有意义，收下就扔。 */
  setWarmup(_warm: boolean): void {}

  /**
   * 桩场景没有输入层，也就永远发不出指令，恒为空。
   * 契约里有这一条是给交互用例用的，那条用例只跑真实场景（见 contract.ts）。
   */
  commands(): [] {
    return []
  }

  /** 桩场景的"手牌"只是几个精灵，没有牌面身份。同上，这一条只给交互用例。 */
  handCards(): [] {
    return []
  }

  step(deltaMs: number): void {
    this.elapsedMs += deltaMs
    if (this.opts.manualClock) gsap.updateRoot(this.elapsedMs / 1000)
    // 手动时钟下 ticker 从没 start 过，这里的 update 只是把契约里那一步走全，
    // 真实场景挂在 ticker 上的系统（剔除、纹理 GC）靠它推进。
    if (this.opts.manualClock) this.ticker.update(this.elapsedMs)
    if (this.dirty) this.render()
  }

  isIdle(): boolean {
    return this.active === 0 && !this.dirty
  }

  /**
   * 视口变了。契约里有这一条是给开发页跟随窗口大小用的，桩场景只会被 bench 驱动，
   * 而剧本的视口是固定的（见 node/profiles.ts），所以这里只把渲染尺寸对上，
   * 不重排已经摆好的牌——重排会让「两遍完全一致」那条断言依赖调用顺序。
   */
  resize(width: number, height: number): void {
    this.opts.width = width
    this.opts.height = height
    this.renderer.resize(width, height)
    this.markDirty()
  }

  counters(): DuelSceneCounters {
    return {
      textCreated: this.textCreated,
      renders: this.renders,
      frameRequests: this.frameRequests,
      // 帧循环在跑的墙钟时间，只有开发页的帧率显示要用。桩场景恒给 0：
      // 它就是给手动时钟的剧本当固定物的，多一个每次都不一样的数只会污染确定性。
      activeMs: 0,
    }
  }

  destroy(): void {
    this.ticker.destroy()
    gsap.globalTimeline.clear()
    // 文字自己生成的纹理必须单独销毁，否则它会留在显存里，泄漏那条检查就会看到常驻内存回不去。
    // 卡面纹理归调用方所有（契约里是传进来的），这里不动。
    for (const card of this.pool) card.label.destroy({ texture: true, textureSource: true })
    this.stage.destroy({ children: true })
    this.renderer.destroy()
    // 主动把上下文丢掉。浏览器同时最多留十几个 WebGL 上下文，一段剧本一个的话很快就到顶，
    // 到顶之后浏览器自己去挤掉最老的那个——那时候我们的 deleteTexture 记账已经错过了。
    // 必须排在 renderer.destroy() 之后：丢了上下文再删纹理，常驻内存就减不回去了。
    this.opts.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

export async function createStubDuelScene(opts: BenchSceneOptions): Promise<BenchScene> {
  configureGsap(opts.manualClock)
  // 纪律 3.8：显式指定 WebGL，暂不开 WebGPU。不走 autoDetectRenderer 就是为了这一条——
  // 自动探测会在支持的机器上挑 WebGPU，计数器包的却是 WebGL 上下文，数字会全变成 0。
  const renderer = new WebGLRenderer()
  await renderer.init({
    canvas: opts.canvas,
    width: opts.width,
    height: opts.height,
    resolution: opts.resolution,
    autoDensity: true,
    antialias: false,
    background: tokens.color.page.background,
  })
  // 不用 Application 而是自己拿 renderer：Application 会建一个自动启动的 Ticker，
  // 那就是一个 rAF 循环，手动时钟下必须没有它。帧循环由 StubScene 自己管。
  const scene = new StubScene(renderer, opts)
  scene.warmup()
  return scene
}
