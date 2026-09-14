/**
 * 首页渲染器（迁移第 30 条「主页人物上 Pixi」）。
 *
 * 层叠自下而上：夜空底 → 四张展示卡 → 桌面弧 → 前景道具 → 文字类 UI（标题、开始匾额、菜单）。
 * 顺序对应的是现实关系：卡摆在桌上被桌沿挡住下半截，地球仪、望远镜这些道具又摆在桌沿上。
 *
 * 这个文件只做四件事：建渲染器、推帧循环、摆版式、把各层发出的操作转给调用方。
 * 各层自己长什么样在旁边三个文件里（版式、展示卡、UI）。
 *
 * 原先这一页还有七张人物抠图和一层逐像素的 alpha 命中（hover 某个人浮出介绍卡），
 * 正式版简化第 2 步整条删掉了：视觉后面要整套重做，而那一层和抠图素材绑得最死。
 */

import { createFakePlatform } from '@ai-duel/platform'
import { autoDetectRenderer, Container, type Renderer, Sprite } from 'pixi.js'
import { bakeTextures } from '../../fx/bakedTextures'
import { TIER_CONFIG } from '../../fx/effectTier'
import { bakeUiTextures } from '../../fx/uiTextures'
import { Animator } from '../../runtime/animator'
import { FrameLoop } from '../../runtime/frameLoop'
import { TextTextureCache } from '../../runtime/textCache'
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
  private readonly deps: HomeCardsDeps & HomeUiDeps
  private readonly background = new Sprite()
  /** 压在展示卡之上的两层：桌面弧在下、前景道具在上。 */
  private readonly table = new Sprite()
  private readonly props = new Sprite()
  private readonly cards: HomeCards
  private readonly ui: HomeUi
  private readonly ownsRenderer: boolean
  private readonly coarsePointer: boolean
  private readonly menuLabels: string[]
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
    this.background.texture = options.textures.background
    this.table.texture = options.textures.table
    this.props.texture = options.textures.props
    this.cards = new HomeCards(options.cards, this.deps)
    this.ui = new HomeUi({ plaque: options.textures.plaque }, menu, this.deps)
    this.stage.addChild(this.background, this.cards, this.table, this.props, this.ui)

    this.layout = this.pick()
    this.applyLayout()
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
    // 三层都是和画等比的整幅图，照画那一块铺满就落在各自该在的位置上。
    for (const sprite of [this.background, this.table, this.props]) {
      sprite.position.set(stage.x, stage.y)
      sprite.setSize(stage.width, stage.height)
    }
    this.cards.place(this.layout.cards)
    this.ui.place(this.layout)
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
    // 外面给的纹理不归这里收（那是调用方的资源）。
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
