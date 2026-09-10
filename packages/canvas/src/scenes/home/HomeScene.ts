/**
 * 首页渲染器（迁移第 30 条「主页人物上 Pixi」）。
 *
 * 层叠自下而上：夜空底 → 四张展示卡 → 七张人物抠图（各带一张发光副本）→ 桌面弧 →
 * 前景道具 → 文字类 UI（标题、开始匾额、菜单、静音）→ 人物介绍卡。
 * 顺序和旧版 `HomeScreen.tsx` 一字不差，对应的是现实关系：人站在桌子后面被桌沿挡住下半身，
 * 地球仪、望远镜这些道具又摆在桌沿上；介绍卡是临时浮出来的信息，压在所有东西之上。
 *
 * 这个文件只做五件事：建渲染器、推帧循环、摆版式、把指针位置换成「停在谁身上」、
 * 把各层发出的操作转给调用方。各层自己长什么样在旁边四个文件里（版式、展示卡、人物、UI）。
 *
 * ## 指针不由人物图层自己收
 *
 * 七张抠图都是和舞台等大的整幅透明图，压在四张展示卡**之上**。让它们收指针事件，
 * 卡就永远 hover 不到了。所以人物一律 `eventMode: 'none'`，命中判定挂在**舞台**上，
 * 靠建场景时烤好的低分辨率 alpha 掩码判（见 castHit.ts）。
 * 展示卡和按钮照常自己收事件，指针压在它们身上时人物不高亮——
 * 那时候该有反馈的是卡和按钮，不是它们身后的人。
 */

import { createFakePlatform } from '@ai-duel/platform'
import { autoDetectRenderer, Container, Rectangle, type Renderer, Sprite } from 'pixi.js'
import { bakeTextures } from '../../fx/bakedTextures'
import { bakeMuteIcons, type MuteIcons } from '../../fx/controlIcons'
import { TIER_CONFIG } from '../../fx/effectTier'
import { bakeUiTextures } from '../../fx/uiTextures'
import { Animator } from '../../runtime/animator'
import { FrameLoop } from '../../runtime/frameLoop'
import { TextTextureCache } from '../../runtime/textCache'
import { CastLayer, type CastLayerDeps } from './castLayer'
import { HomeCards, type HomeCardsDeps } from './homeCards'
import { type HomeAction, type HomeScene, type HomeSceneOptions, homeMenu } from './homeContract'
import { type HomeLayout, pickHomeLayout } from './homeLayout'
import { HomeUi, type HomeUiDeps } from './homeUi'

export async function createHomeScene(options: HomeSceneOptions): Promise<HomeScene> {
  const renderer = await autoDetectRenderer({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    // 3.8：显式走 WebGL。数组形式是排除式的——WebGPU 不在名单里就整个不试。
    preference: ['webgl'],
    antialias: true,
    autoDensity: true,
    // 底色不透明：这一页整幅铺满，透明只会让网页壳的底色从画的边缘漏出来。
    background: '#0b0d15',
  })
  return new HomeSceneImpl(renderer, options, true).handle()
}

/** 挂在别人的渲染器上的首页（组件目录页那条路，理由同 mountRoomScene）。 */
export interface MountedHomeScene extends HomeScene {
  readonly root: Container
  /** 推进一帧但**不**渲染——渲染归外面那套帧循环。返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
}

export function mountHomeScene(renderer: Renderer, options: HomeSceneOptions): MountedHomeScene {
  return new HomeSceneImpl(renderer, options, false).mounted()
}

/** 场景的全部可变状态。拆成类只是为了让下面那堆闭包有个明确的家，它不对外导出。 */
class HomeSceneImpl {
  private readonly renderer: Renderer
  private readonly stage = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: HomeCardsDeps & CastLayerDeps & HomeUiDeps
  private readonly background = new Sprite()
  private readonly cards: HomeCards
  private readonly cast: CastLayer
  private readonly ui: HomeUi
  private readonly ownsRenderer: boolean
  private readonly coarsePointer: boolean
  private readonly menuLabels: string[]
  /** 静音钮那两枚剪影是场景自己烤的还是外面给的。自己烤的才归自己销毁。 */
  private readonly ownIcons: MuteIcons | null
  private viewport: { width: number; height: number }
  private layout: HomeLayout
  /** 上一帧展示卡的倾斜收敛了没有。帧循环每帧都要问一次「忙不忙」，缓存下来省得重算。 */
  private tiltBusy = false
  private destroyed = false

  constructor(renderer: Renderer, options: HomeSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.ownsRenderer = ownsRenderer
    this.coarsePointer = options.coarsePointer === true
    this.viewport = { width: options.width, height: options.height }
    this.frameLoop = new FrameLoop({
      manual: options.manualClock === true,
      render: (deltaMs) => this.render(deltaMs),
      isBusy: () => !this.idle(),
    })
    const tier = TIER_CONFIG[options.tier ?? 'mid']
    this.deps = {
      baked: bakeTextures(renderer),
      ui: bakeUiTextures(renderer),
      text: new TextTextureCache(renderer),
      animator: new Animator(() => this.frameLoop.wake()),
      glare: tier.glare,
      tilt: tier.cardTilt,
      platform: options.platform ?? createFakePlatform(),
      // 按钮按下那一声。资源不归 canvas 管，装配层现在也没往下透（音效是第 33 条的事）。
      clickSound: null,
    }

    const menu = homeMenu(options.dev === true)
    this.menuLabels = menu.map((item) => item.label)
    // 真图标还没有（需求单图标 B），外面不给就现画一对占位（同 DuelScene 顶栏那两颗钮）。
    this.ownIcons = options.textures.mute === undefined ? bakeMuteIcons(renderer) : null
    const mute = options.textures.mute ?? this.ownIcons!
    this.background.texture = options.textures.background
    this.cards = new HomeCards(options.cards, this.deps)
    this.cast = new CastLayer(
      renderer,
      options.cast,
      [options.textures.table, options.textures.props],
      this.deps,
    )
    this.ui = new HomeUi(
      { plaque: options.textures.plaque, mute },
      menu,
      options.muted === true,
      this.deps,
    )
    this.stage.addChild(this.background, this.cards, this.cast, this.ui, this.cast.panels)

    this.layout = this.pick()
    this.applyLayout()
    this.bindStage()
  }

  private pick(): HomeLayout {
    return pickHomeLayout(
      this.viewport.width,
      this.viewport.height,
      this.menuLabels,
      this.coarsePointer,
    )
  }

  private applyLayout(): void {
    const { stage } = this.layout
    this.background.position.set(stage.x, stage.y)
    this.background.setSize(stage.width, stage.height)
    this.cards.place(this.layout.cards)
    this.cast.place(this.layout)
    this.ui.place(this.layout)
    this.stage.hitArea = new Rectangle(0, 0, this.viewport.width, this.viewport.height)
  }

  /**
   * 舞台自己收指针事件，专门用来做人物的 alpha 命中。
   *
   * `pointermove` 落到舞台上，说明指针**没有**压在任何一个自己收事件的东西上
   *（展示卡、按钮都会把事件截走），所以「指着按钮却高亮了它身后的人」这件事
   * 在这里天然不会发生——旧版为此专门维护了一份 `UI_CONTROL_SELECTOR` 名单。
   * 指针压在卡或钮上时舞台收不到 move，于是也没人去改高亮：那时候上一个人会一直亮着。
   * 这一点和旧版一致（旧版只在移动到别人身上或离开舞台时才换）。
   */
  private bindStage(): void {
    this.stage.eventMode = 'static'
    this.stage.on('pointermove', (event) => {
      const point = this.stage.toLocal(event.global)
      this.cast.setHovered(this.cast.hitTest(point.x, point.y))
    })
    /*
     * 触屏上点一下人物也要亮：手指点一下（不划动）压根不会发 pointermove，只有 pointerdown。
     * 鼠标不走这条——它的 move 已经够了，按下再探一次是白跑一帧。
     */
    this.stage.on('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return
      const point = this.stage.toLocal(event.global)
      this.cast.setHovered(this.cast.hitTest(point.x, point.y))
    })
    /*
     * 指针离开画布就收掉高亮，但**只对鼠标**：触屏的 pointerleave 是手指抬起那一刻发的，
     * 照做的话点谁都只亮一下就灭，介绍卡根本来不及看（旧版同一处的理由）。
     */
    this.stage.on('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return
      this.cast.setHovered(null)
    })
  }

  private advance(deltaMs: number): boolean {
    // 展示卡的倾斜是逐帧跟随（不走补间），要单独问它收敛了没有。
    this.tiltBusy = this.cards.advance(deltaMs)
    return this.tiltBusy || this.deps.animator.isBusy()
  }

  private render(deltaMs: number): void {
    this.advance(deltaMs)
    this.renderer.render(this.stage)
  }

  /** 首页几乎永远不空闲：主入口那颗匾额常驻浮动（契约里写明了这一点）。 */
  private idle(): boolean {
    return !this.deps.animator.isBusy() && !this.tiltBusy
  }

  handle(): HomeScene {
    return {
      onAction: (callback: (action: HomeAction) => void) => this.ui.setOnAction(callback),
      setMuted: (muted: boolean) => this.ui.setMuted(muted),
      hoverCast: (index: number | null) => this.cast.setHovered(index),
      step: (deltaMs) => this.frameLoop.step(deltaMs),
      isIdle: () => this.idle(),
      resize: (width, height) => this.resize(width, height),
      destroy: () => this.destroy(),
    }
  }

  mounted(): MountedHomeScene {
    return { ...this.handle(), root: this.stage, advance: (deltaMs) => this.advance(deltaMs) }
  }

  private resize(width: number, height: number): void {
    if (width === this.viewport.width && height === this.viewport.height) return
    this.viewport = { width, height }
    this.renderer.resize(width, height)
    this.layout = this.pick()
    this.applyLayout()
    this.frameLoop.wake()
  }

  /** 拆场景。调第二次直接返回（同 DuelScene / RoomScene 的理由）。 */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    // 顺序要紧：先掐补间，再还 GSAP 的时钟（同 DuelScene 的 destroy）。
    this.deps.animator.destroy()
    this.frameLoop.destroy()
    this.deps.ui.destroy()
    this.deps.baked.destroy()
    this.deps.text.destroy()
    // 外面给的纹理不归这里收（那是调用方的资源），自己烤的那两枚才收。
    this.ownIcons?.on.destroy(true)
    this.ownIcons?.off.destroy(true)
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
