/**
 * 桩场景：几十个 Pixi 精灵，按 contract.ts 的契约实现。
 *
 * 它不是游戏的一部分，是测量骨架的**固定物**：真实场景（迁移第 1 条）还在同事手里的时候，
 * 用它来验证计数器、剧本、阈值这一整套东西自己是对的。它刻意做到每条计数器都会动——
 * 多张不同纹理（数纹理切换）、叠加混合的粒子（数混合切换）、文字对象（数文字重建）、
 * 高档位的全屏发光（数过度绘制）。
 *
 * 真实场景接上之后这个文件留着：骨架自身有回归时，桩场景是唯一不会跟着一起变的对照组。
 */

import { tokens } from '@ai-duel/design'
import { gsap } from 'gsap'
import { Container, Sprite, Text, Texture, Ticker, WebGLRenderer } from 'pixi.js'
import type { DuelPrototype, DuelPrototypeOptions, SceneCounters } from './contract'
import { mulberry32 } from './random'
import { boardSlot, deckAnchor, fanSlot, TIERS } from './stubLayout'

interface CardView {
  root: Container
  face: Sprite
  label: Text
  key: string
}

type Vars = Record<string, unknown> & { duration: number }

/** gsap 的根时间轴当前是不是由我们手动推。模块级的，因为 gsap 本身就是单例。 */
let gsapDetached = false

/**
 * 手动时钟下必须把 gsap 自己的 rAF 循环摘掉，否则它会在 step() 之外偷偷推进补间，
 * 剧本就不再是确定性的了。这是 gsap 官方给的手动驱动写法。
 */
function configureGsap(manual: boolean) {
  gsap.ticker.lagSmoothing(0)
  if (manual && !gsapDetached) {
    gsap.ticker.remove(gsap.updateRoot)
    gsap.ticker.sleep()
    gsapDetached = true
  } else if (!manual && gsapDetached) {
    gsap.ticker.add(gsap.updateRoot)
    gsap.ticker.wake()
    gsapDetached = false
  }
}

class StubScene implements DuelPrototype {
  private readonly stage = new Container()
  private readonly cardLayer = new Container()
  private readonly fxLayer = new Container()
  private readonly ticker = new Ticker()
  private readonly pool: CardView[] = []
  private readonly particles: Sprite[] = []
  private readonly random: () => number
  private glow: Sprite | null = null
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
    private readonly opts: DuelPrototypeOptions,
  ) {
    this.random = mulberry32(opts.seed)
    this.stage.addChild(this.background(), this.cardLayer, this.fxLayer)
    this.buildPool()
    this.buildEffects()
    if (!opts.manualClock) this.ticker.add(this.tick)
  }

  private background(): Sprite {
    const bg = new Sprite(Texture.WHITE)
    bg.width = this.opts.width
    bg.height = this.opts.height
    // 颜色和时长一律读 design 包的令牌，组件里不写死数值（7.1 第 4 条）。
    bg.tint = tokens.color.paper.night
    return bg
  }

  /**
   * 牌库里每张牌都先建好对象放进池子，之后只在池子里搬，运行期不 new。
   * 文字尤其重要：纪律 3.5 要求文字只创建一次，动画期间 textCreated 必须纹丝不动。
   */
  private buildPool() {
    for (const key of this.opts.deck) {
      const face = new Sprite(this.opts.textures.faces[key] ?? this.opts.textures.back)
      face.anchor.set(0.5)
      const label = new Text({
        text: key,
        style: { fontFamily: 'sans-serif', fontSize: 14, fill: tokens.color.paper.base },
      })
      this.textCreated += 1
      label.anchor.set(0.5)
      label.y = face.height / 2 - 16
      const root = new Container()
      root.addChild(face, label)
      root.visible = false
      this.cardLayer.addChild(root)
      this.pool.push({ root, face, label, key })
    }
  }

  private buildEffects() {
    for (let i = 0; i < TIERS[this.opts.tier].particles; i += 1) {
      const particle = new Sprite(Texture.WHITE)
      particle.anchor.set(0.5)
      particle.width = 14
      particle.height = 14
      particle.blendMode = 'add'
      particle.visible = false
      this.fxLayer.addChild(particle)
      this.particles.push(particle)
    }
    if (!TIERS[this.opts.tier].fullscreenGlow) return
    const glow = new Sprite(Texture.WHITE)
    glow.width = this.opts.width
    glow.height = this.opts.height
    glow.tint = tokens.color.theme.purple
    glow.blendMode = 'add'
    glow.visible = false
    this.fxLayer.addChild(glow)
    this.glow = glow
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

  async deal(count: number): Promise<void> {
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

  async playCard(handIndex: number): Promise<void> {
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

  async flip(handIndex: number): Promise<void> {
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
   */
  hover(handIndex: number | null): void {
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

  counters(): SceneCounters {
    return {
      textCreated: this.textCreated,
      renders: this.renders,
      frameRequests: this.frameRequests,
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

export async function createStubDuelPrototype(opts: DuelPrototypeOptions): Promise<DuelPrototype> {
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
