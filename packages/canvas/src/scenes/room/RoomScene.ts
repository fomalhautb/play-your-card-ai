/**
 * 房间页渲染器（迁移第 27 条后半）：一块面板、三颗钮、一块房间码。
 *
 * 房间页归 canvas 是定好的（memory 里那条「房间页归 canvas」）：它将来要摆匹配房那张
 * 1199×325 的图片底板和一整排切片素材，那种东西不该拿 DOM 拼。
 * 现在这一版只用基础件（面板、匾额按钮、文字、气泡）搭出**能打完一局**的最小形态，
 * 美术资源等第 33 条搬进来再补。
 *
 * 这个文件只做四件事：建渲染器、推帧循环、把状态转给面板、把面板发出的操作转给调用方。
 * 「一份状态长什么样」在旁边的 roomPanel.ts；契约在 roomContract.ts。
 *
 * 契约里那几条硬要求同样落在这里：显式走 WebGL 不开 WebGPU（3.8）；
 * 手动时钟下不注册任何真实时间源、真实时钟下没有动画就停帧循环（3.6）。
 */

import { createFakePlatform } from '@ai-duel/platform'
import { autoDetectRenderer, Container, Rectangle, type Renderer } from 'pixi.js'
import { bakeUiTextures } from '../../fx/uiTextures'
import { Animator } from '../../runtime/animator'
import { FrameLoop } from '../../runtime/frameLoop'
import { TextTextureCache } from '../../runtime/textCache'
import type { RoomAction, RoomScene, RoomSceneOptions, RoomView } from './roomContract'
import { RoomPanel, type RoomPanelDeps } from './roomPanel'

export async function createRoomScene(options: RoomSceneOptions): Promise<RoomScene> {
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
    // 底色留透明：房间页盖在网页壳自己的背景上（将来是那张匹配房底图），
    // 画一层不透明的页面底色只会把它挡掉。
    backgroundAlpha: 0,
  })
  return new RoomSceneImpl(renderer, options, true).handle()
}

/** 挂在别人的渲染器上的房间页：多一个根节点和一个「只推进不渲染」的入口。 */
export interface MountedRoomScene extends RoomScene {
  /** 场景的根节点。外面把它挂到自己的舞台上。 */
  readonly root: Container
  /** 推进一帧但**不**渲染——渲染归外面那套帧循环。返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
}

/**
 * 把房间页挂到一个**已经有的**渲染器上（组件目录页那条路，理由见 mountDuelScene）。
 * 渲染器不归它销毁，别的东西照常自己收。
 */
export function mountRoomScene(renderer: Renderer, options: RoomSceneOptions): MountedRoomScene {
  return new RoomSceneImpl(renderer, options, false).mounted()
}

/** 场景的全部可变状态。拆成类只是为了让下面那堆闭包有个明确的家，它不对外导出。 */
class RoomSceneImpl {
  private readonly renderer: Renderer
  private readonly stage = new Container()
  private readonly frameLoop: FrameLoop
  private readonly deps: RoomPanelDeps
  private readonly panel: RoomPanel
  /** 渲染器是自己建的还是挂在别人的上面。自己建的才归自己销毁。 */
  private readonly ownsRenderer: boolean
  private viewport: { width: number; height: number }
  private destroyed = false

  constructor(renderer: Renderer, options: RoomSceneOptions, ownsRenderer: boolean) {
    this.renderer = renderer
    this.ownsRenderer = ownsRenderer
    this.viewport = { width: options.width, height: options.height }
    this.frameLoop = new FrameLoop({
      manual: options.manualClock === true,
      render: (deltaMs) => this.render(deltaMs),
      isBusy: () => !this.idle(),
    })
    this.deps = {
      ui: bakeUiTextures(renderer),
      text: new TextTextureCache(renderer),
      animator: new Animator(() => this.frameLoop.wake()),
      // 没给 platform 就用 platform 包自带的假实现（同 scenes/duel/deps.ts 的理由）。
      platform: options.platform ?? createFakePlatform(),
      // 按钮按下时叫的那一声。资源不归 canvas 管，暂时一律 null（音频是第 33 条）。
      clickSound: null,
    }
    this.panel = new RoomPanel(this.viewport, this.deps)
    this.stage.addChild(this.panel)
    this.applyStageHitArea()
    this.center()
  }

  /**
   * 舞台自己也吃指针事件。
   *
   * 不是为了接点击，而是为了**把点击挡在这一页里**：面板之外那一圈是空地，
   * 不给舞台一个命中区的话，指针事件会一路穿到底下的 DOM 上去。
   */
  private applyStageHitArea(): void {
    this.stage.eventMode = 'static'
    this.stage.hitArea = new Rectangle(0, 0, this.viewport.width, this.viewport.height)
  }

  /** 面板在视口正中。窄屏上面板本身会先缩一档（见 roomPanel 的 makePlate）。 */
  private center(): void {
    this.panel.position.set(
      (this.viewport.width - this.panel.boxWidth) / 2,
      (this.viewport.height - this.panel.boxHeight) / 2,
    )
  }

  /** 推进一帧但不画。这一页没有自己的虚拟时钟，动的只有补间，全在 animator 账上。 */
  private advance(_deltaMs: number): boolean {
    return !this.idle()
  }

  private render(deltaMs: number): void {
    this.advance(deltaMs)
    this.renderer.render(this.stage)
  }

  private idle(): boolean {
    return !this.deps.animator.isBusy()
  }

  /**
   * 摆完新东西之后**立刻**画一帧，不等下一次 rAF。
   *
   * 不是为了画面早一帧出来，是为了**点得中**：Pixi 的命中判定读的是 `worldTransform`，
   * 而那份变换只在渲染的时候才算。刚重建出来的按钮在渲染之前，位置还停在上一份布局上——
   * 于是画面上钮在这儿、点上去却没反应。浏览器把这一页判成后台时 rAF 会被节流甚至停掉，
   * 这个缝就能拖到几秒钟（联机端到端两个窗口同时开着时必然踩上）。
   *
   * 这一页一局只变几次状态，多画这一帧不心疼。挂在别人渲染器上的那一档（目录页）不自己画：
   * 那边的帧循环归调用方，插一帧会把它正在拍的画面冲掉。
   */
  private paint(): void {
    this.frameLoop.wake()
    if (this.ownsRenderer) this.renderer.render(this.stage)
  }

  handle(): RoomScene {
    return {
      setView: (view: RoomView) => {
        this.panel.setView(view)
        this.center()
        this.paint()
      },
      onAction: (callback: (action: RoomAction) => void) => this.panel.setOnAction(callback),
      step: (deltaMs) => this.frameLoop.step(deltaMs),
      isIdle: () => this.idle(),
      resize: (width, height) => this.resize(width, height),
      destroy: () => this.destroy(),
    }
  }

  mounted(): MountedRoomScene {
    return { ...this.handle(), root: this.stage, advance: (deltaMs) => this.advance(deltaMs) }
  }

  private resize(width: number, height: number): void {
    if (width === this.viewport.width && height === this.viewport.height) return
    this.viewport = { width, height }
    this.renderer.resize(width, height)
    this.applyStageHitArea()
    this.panel.resize(this.viewport)
    this.center()
    this.paint()
  }

  /**
   * 拆场景。调第二次直接返回——Pixi 的 `renderer.destroy()` 会把内部几个系统的表置成 null，
   * 第二次进去就在 null 上取属性，当场抛 TypeError（同 DuelScene 的理由）。
   */
  private destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    /*
     * 顺序要紧：**先掐补间，再还 GSAP 的时钟**（同 DuelScene 的 destroy）。
     * 还时钟那一下会同步跑一帧，喂进去的时刻比手动推到的位置靠后几十秒，
     * 还活着的补间会被一口气演到终点——而那一帧要是写到已经销毁的对象上就当场抛。
     */
    this.deps.animator.destroy()
    this.frameLoop.destroy()
    this.deps.ui.destroy()
    this.deps.text.destroy()
    this.stage.destroy({ children: true, texture: false, textureSource: false })
    if (this.ownsRenderer) this.renderer.destroy()
  }
}
