/**
 * 把真指针（Pixi 的事件 + 一条 DOM 的 wheel）接到三个合成入口上。
 *
 * 从 DeckScene.ts 里拎出来的（400 行那条上限逼的）。这一层只做三件事：
 * 换算坐标、决定这一下该交给谁（翻面 / 抓牌 / 放大层）、把滚轮转成一次滚动。
 * 真指针和交互测试走的是同一条路——测试喂的就是这一层最后调的那三个入口。
 *
 * 坐标换算有两套，因为来源不同：
 * Pixi 的事件给的是**全局**坐标，过 `stage.toLocal` 一步到舞台坐标；
 * DOM 的 wheel 给的是视口像素，自己减偏移、除缩放（`toStage`）。
 */

import { type Container, Rectangle } from 'pixi.js'
import type { DeckHover } from './hover'
import type { DeckInput } from './input'
import type { DeckInspect } from './inspect'
import type { DeckLayout } from './layout/types'
import type { DeckParts } from './partsSpec'

export interface PointerHost {
  stage: Container
  canvas: HTMLCanvasElement
  layout(): DeckLayout
  parts(): DeckParts
  input(): DeckInput
  hover(): DeckHover
  inspect(): DeckInspect
  wake(): void
}

/** 视口坐标 → 舞台坐标。对外那三个指针入口收的是视口坐标（见 DeckScene 的文件头）。 */
export function toStage(layout: DeckLayout, x: number, y: number): { x: number; y: number } {
  const { stage } = layout
  return { x: (x - stage.x) / stage.scale, y: (y - stage.y) / stage.scale }
}

/** 舞台上的指针：拖拽走合成入口那三条，点遮罩关掉放大查看。 */
export function bindDeckPointer(host: PointerHost): void {
  const { stage } = host
  stage.eventMode = 'static'
  const layout = host.layout()
  stage.hitArea = new Rectangle(0, 0, layout.width, layout.height)
  const at = (global: { x: number; y: number }) => stage.toLocal(global)

  stage.on('pointerdown', (event) => {
    if (host.inspect().open) return
    const point = at(event.global)
    // 点问号章是翻面，不是抓牌——它先吃这一下。
    if (host.hover().tap(point.x, point.y)) return
    host.input().pressAt(point.x, point.y, event.pointerType)
  })
  stage.on('globalpointermove', (event) => {
    const point = at(event.global)
    if (host.inspect().open) {
      host.inspect().move(point.x, point.y)
      return
    }
    /*
     * 正拖着或正滚着的时候不喂 hover：那一路要算「指针压在哪一格上」，
     * 而此刻指针底下那一格要么正空着（牌被抓走了）、要么正在往别处滑，
     * 亮一圈框和让卡跟着歪都只会添乱。
     */
    if (host.input().isBusy()) host.hover().release()
    else host.hover().move(point.x, point.y)
    host.input().moveTo(point.x, point.y)
  })
  const release = (event: { global: { x: number; y: number } }) => {
    const point = at(event.global)
    host.input().releaseAt(point.x, point.y)
  }
  stage.on('pointerup', release)
  stage.on('pointerupoutside', release)
  host.parts().reveal.on('pointertap', () => host.inspect().hide())
}

/**
 * 滚轮。
 *
 * 只有这一处要听真实 DOM 事件：Pixi 的事件系统不转发 wheel。`passive: false` 是为了
 * 能 `preventDefault`——不挡的话页面本身会跟着滚，而这一页是整屏钉死的。
 * 滚动量要除掉舞台缩放：滚轮给的是屏幕像素，而内容量在舞台坐标里。
 */
export function deckWheelHandler(host: PointerHost): (event: WheelEvent) => void {
  return (event) => {
    if (host.inspect().open) return
    const layout = host.layout()
    const rect = host.canvas.getBoundingClientRect()
    const point = toStage(layout, event.clientX - rect.left, event.clientY - rect.top)
    if (host.input().wheelAt(point.x, point.y, event.deltaY / layout.stage.scale)) {
      event.preventDefault()
      host.wake()
    }
  }
}
