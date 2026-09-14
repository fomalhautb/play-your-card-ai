/**
 * 首页渲染器（迁移第 30 条「主页人物上 Pixi」，正式版简化第 4 步剥成素方块）。
 *
 * 现在只剩两层：上面一排展示卡（还带 hover 抬起和跟指针倾斜，那是卡牌动画，留着），
 * 下面一列素方块（「开始游戏」加菜单）。
 *
 * 从前这一页是一幅 1672×941 的画：夜空底 → 展示卡 → 桌面弧 → 前景道具 → 标题和匾额。
 * 视觉后面整套重做，那四层底图、花饰、匾额按钮、文字钮一起删了，
 * 连带着「等图」这道闸门也不需要了（见 client 的 HomeScreen.tsx）。
 *
 * 这个文件做四件事：建渲染器、推帧循环、摆版式、把方块发出的操作转给调用方。
 * 菜单那一列直接建在这里而不是另起一层——它现在就是一个 for 循环加几个 Box。
 */

import { autoDetectRenderer, Container, Graphics, type Renderer } from 'pixi.js'
import { Box, CANVAS_BACKGROUND } from '../../components/Box'
import { bakeTextures } from '../../fx/bakedTextures'
import { TIER_CONFIG } from '../../fx/effectTier'
import { Animator } from '../../runtime/animator'
import { FrameLoop } from '../../runtime/frameLoop'
import { TextTextureCache } from '../../runtime/textCache'
import { HomeCards, type HomeCardsDeps } from './homeCards'
import {
  type HomeAction,
  type HomeMenuItem,
  type HomeScene,
  type HomeSceneOptions,
  homeMenu,
} from './homeContract'
import { type HomeLayout, pickHomeLayout } from './homeLayout'

/** 主入口那一块印的字。 */
const START_LABEL = '开始游戏'

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
    background: CANVAS_BACKGROUND,
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
  private readonly deps: HomeCardsDeps & { text: TextTextureCache }
  /**
   * 垫在最底下那块浅灰。渲染器的底色只在自己建渲染器那一档管用，
   * 挂在目录页的渲染器上时靠这一块（见 Box.ts 的 CANVAS_BACKGROUND）。
   */
  private readonly backdrop = new Graphics()
  private readonly cards: HomeCards
  /** 「开始游戏」和菜单那一列。换版式时整层重建。 */
  private readonly ui = new Container()
  private readonly ownsRenderer: boolean
  private readonly coarsePointer: boolean
  private readonly menu: HomeMenuItem[]
  private viewport: { width: number; height: number }
  private layout: HomeLayout
  private onAction: ((action: HomeAction) => void) | null = null
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
      text: new TextTextureCache(renderer),
      animator: new Animator(() => this.frameLoop.wake()),
      glare: tier.glare,
      shadow: tier.cardShadow,
      tilt: tier.cardTilt,
    }

    this.menu = homeMenu(options.dev === true)
    this.cards = new HomeCards(options.cards, this.deps)
    this.stage.addChild(this.backdrop, this.cards, this.ui)

    this.layout = this.pick()
    this.applyLayout()
    this.paint()
  }

  /**
   * 摆完新东西之后**立刻**画一帧，不等下一次 rAF。理由同 RoomScene 的 `paint`：
   * Pixi 的命中判定读 `worldTransform`，那份变换只在渲染时才算，不画这一帧按钮点不中。
   *
   * 这一页尤其绕不开它：正式版简化第 4 步之前主入口那颗匾额挂着一条永不结束的浮动补间，
   * 帧循环因此一直醒着、每帧都在画；换成素方块之后整页静止，
   * **没有任何东西会叫醒帧循环**——不自己画这一帧，画布会一直是空的（端到端在这里红过）。
   */
  private paint(): void {
    this.frameLoop.wake()
    if (this.ownsRenderer) this.renderer.render(this.stage)
  }

  private pick(): HomeLayout {
    return pickHomeLayout(
      this.viewport.width,
      this.viewport.height,
      this.menu.map((item) => item.label),
      this.coarsePointer,
    )
  }

  /**
   * 按当前这一档版式摆好整页。
   *
   * 方块整层重建而不是逐个 `setSize`：这一页一辈子只在窗口尺寸变化时重排几次，
   * 不在动画期间（3.10 管的是稳态每帧）。方块上没有补间，所以直接销毁就行，
   * 不用走 `killAndDestroy`。
   */
  private applyLayout(): void {
    const { width, height } = this.viewport
    this.backdrop.clear().rect(0, 0, width, height).fill({ color: CANVAS_BACKGROUND })
    this.cards.place(this.layout.cards)
    for (const child of this.ui.removeChildren()) child.destroy({ children: true })
    this.ui.addChild(this.box(this.layout.start, START_LABEL, { kind: 'start' }))
    this.menu.forEach((item, index) => {
      const rect = this.layout.menu[index]
      if (rect === undefined) return
      this.ui.addChild(this.box(rect, item.label, { kind: 'menu', item: item.id }))
    })
  }

  private box(
    rect: { x: number; y: number; width: number; height: number },
    label: string,
    action: HomeAction,
  ): Box {
    const box = new Box({ width: rect.width, height: rect.height, label, size: 'body' }, this.deps)
    box.position.set(rect.x, rect.y)
    box.onPress(() => this.onAction?.(action))
    return box
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

  private idle(): boolean {
    return !this.deps.animator.isBusy() && !this.tiltBusy
  }

  handle(): HomeScene {
    return {
      onAction: (callback: (action: HomeAction) => void) => {
        this.onAction = callback
      },
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
    // 外面给的纹理不归这里收（那是调用方的资源）。
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
