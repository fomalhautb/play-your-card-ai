/**
 * 房间页面板里那一摞东西：一块面板、几行字、几颗钮、一条提示。
 *
 * 和场景壳（RoomScene.ts）分开，是因为两者变化的理由不同：壳管渲染器、帧循环、
 * 视口和销毁，这里管「一份 `RoomView` 长什么样」。
 *
 * 正式版简化第 4 步把这一页整个换成素方块（见 components/Box.ts）：从前的纸面底板、
 * 匾额按钮、夜色气泡全删了，几何也从「面板内的相对坐标」改成由 `roomLayout.ts`
 * 统一算出视口坐标——端到端用例要读同一份几何算落点（见 client 的 e2e/roomPage.ts）。
 *
 * ## 按钮那一层不跟着字走
 *
 * 换文字一律是换整块方块（`Box` 建好之后只有 `setLabel` 能换内容，但那会换掉整张纹理），
 * 所以「字」那一层每变一次就整层重建——这一页一局只变几次，也不在动画期间。
 *
 * 但**按钮不能跟着一起重建**。这一页的状态有一半是对面推过来的（`room:peer`：他进房了、
 * 他准备了），随时可能在玩家按着某颗钮的那几毫秒里到达。跟着重建的话，那颗钮会在
 * pointerdown 和 pointerup 之间被销毁，松手时已经没人接了——表现就是「我点了准备，
 * 没反应」，而且只在对面恰好同时动作时才出现。所以按钮单独一层，
 * 只有**那一组钮本身变了**（哪几颗、印什么字、灰不灰）才重建。
 */

import { Container } from 'pixi.js'
import { Box, type BoxDeps, type BoxSize } from '../../components/Box'
import { type RoomAction, type RoomButtonId, type RoomView, roomButtons } from './roomContract'
import { pickRoomLayout, type RoomLayout, type RoomRect } from './roomLayout'

/** 这一页要用到的依赖，就是素方块那一份（一个文字纹理缓存）。 */
export type RoomPanelDeps = BoxDeps

/** 标题那一行印什么。 */
const TITLE = '联机对战'

/** 每颗钮印什么字。「准备」按点没点过换字，所以它的两档单列。 */
const CAPTIONS: Record<RoomButtonId, string> = {
  match: '匹配',
  create: '开房',
  join: '加入',
  cancel: '取消',
  ready: '准备',
  leave: '离开',
}

/** 点过之后「准备」印的字。 */
const READY_DONE = '已准备'

/**
 * 面板里那一摞。它自己是个 Container，原点在**视口**左上角——
 * 版式给的就是视口坐标，壳那边不用再居中一次。
 */
export class RoomPanel extends Container {
  private readonly deps: RoomPanelDeps
  /** 面板那块方块。换视口时重画。 */
  private readonly plate: Box
  /** 几行字。每次变化整层重建。 */
  private readonly rows = new Container()
  /** 按钮。只有那一组钮本身变了才重建，理由见文件头。 */
  private readonly buttons = new Container()
  /** 提示那一条。 */
  private readonly notices = new Container()
  private viewport: { width: number; height: number }
  private layout: RoomLayout
  private view: RoomView | null = null
  /** 上一次摆出来的那组钮的指纹。变了才重建。 */
  private buttonKey: string | null = null
  private onAction: ((action: RoomAction) => void) | null = null

  constructor(viewport: { width: number; height: number }, deps: RoomPanelDeps) {
    super()
    this.deps = deps
    this.label = 'room-panel'
    this.viewport = viewport
    this.layout = pickRoomLayout(viewport.width, viewport.height, 0)
    this.plate = new Box({ width: this.layout.panel.width, height: this.layout.panel.height }, deps)
    this.plate.position.set(this.layout.panel.x, this.layout.panel.y)
    this.addChild(this.plate, this.rows, this.buttons, this.notices)
  }

  /** 按了钮叫谁。 */
  setOnAction(callback: (action: RoomAction) => void): void {
    this.onAction = callback
  }

  /** 摆一份状态。同一份摆两次什么都不做——装配层每渲染一次都会调它。 */
  setView(view: RoomView): void {
    const before = this.view
    if (before !== null && sameView(before, view)) return
    this.view = view
    // 换状态可能连按钮颗数一起换（三颗入口钮 → 一颗取消），版式得先按新的颗数重算。
    this.relayout()
    this.rebuildRows()
    this.rebuildButtons()
    if (before?.notice !== view.notice) this.rebuildNotice()
  }

  /** 视口变了：整套重摆。 */
  resize(viewport: { width: number; height: number }): void {
    this.viewport = viewport
    this.relayout()
    // 尺寸变了，按钮的落点也跟着变，所以这一趟连按钮一起重建。
    this.buttonKey = null
    this.rebuildRows()
    this.rebuildButtons()
    this.rebuildNotice()
  }

  /** 这一份状态摆几颗钮。版式要按它排（一颗居中、两颗并排、三颗竖排）。 */
  private buttonCount(): number {
    const view = this.view
    return view === null ? 0 : roomButtons(view.phase, view.ready).length
  }

  /** 按当前的视口和按钮颗数重算版式，并把面板那块方块摆好。 */
  private relayout(): void {
    this.layout = pickRoomLayout(this.viewport.width, this.viewport.height, this.buttonCount())
    this.plate.setSize(this.layout.panel.width, this.layout.panel.height)
    this.plate.position.set(this.layout.panel.x, this.layout.panel.y)
  }

  private clear(layer: Container): void {
    // 这一页一条补间都没有（素方块没有任何动效），直接销毁就行。
    for (const child of layer.removeChildren()) child.destroy({ children: true })
  }

  private rebuildRows(): void {
    this.clear(this.rows)
    const view = this.view
    if (view === null) return
    this.addRow(this.layout.title, TITLE, 'title')
    if (view.account !== null) this.addRow(this.layout.account, view.account, 'small')
    if (view.code !== null) this.addRow(this.layout.code, view.code, 'title')
    if (view.status !== null) this.addRow(this.layout.status, view.status, 'body')
  }

  private rebuildButtons(): void {
    const view = this.view
    if (view === null) return
    const ids = roomButtons(view.phase, view.ready)
    // 指纹里带上全部会影响这几颗钮长相和行为的东西：哪几颗、印什么字、灰不灰。
    const key = ids.map((id) => `${id}|${this.captionOf(id)}|${this.disabledOf(id)}`).join(',')
    if (key === this.buttonKey) return
    this.buttonKey = key
    this.clear(this.buttons)
    ids.forEach((id, index) => {
      const rect = this.layout.buttons[index]
      if (rect === undefined) return
      const box = new Box(
        { width: rect.width, height: rect.height, label: this.captionOf(id) },
        this.deps,
      )
      box.position.set(rect.x, rect.y)
      box.setDisabled(this.disabledOf(id))
      box.onPress(() => this.onAction?.({ kind: id } as RoomAction))
      this.buttons.addChild(box)
    })
  }

  private captionOf(id: RoomButtonId): string {
    if (id === 'ready' && this.view?.ready === 'done') return READY_DONE
    return CAPTIONS[id]
  }

  /**
   * 点过就灰掉：服务端不收第二条 `room:ready`（回 `already-ready`），
   * 让钮还能按只会换来一句报错。别的钮都没有禁用档。
   */
  private disabledOf(id: RoomButtonId): boolean {
    return id === 'ready' && this.view?.ready === 'done'
  }

  private rebuildNotice(): void {
    this.clear(this.notices)
    const notice = this.view?.notice
    if (notice === undefined || notice === null) return
    const rect = this.layout.notice
    const box = new Box(
      { width: rect.width, height: rect.height, label: notice, size: 'small' },
      this.deps,
    )
    box.position.set(rect.x, rect.y)
    this.notices.addChild(box)
  }

  private addRow(rect: RoomRect, content: string, size: BoxSize): void {
    const box = new Box({ width: rect.width, height: rect.height, label: content, size }, this.deps)
    box.position.set(rect.x, rect.y)
    this.rows.addChild(box)
  }
}

/** 两份状态一不一样。逐字段比，避免装配层每渲染一次就重建一遍面板。 */
function sameView(a: RoomView, b: RoomView): boolean {
  return (
    a.account === b.account &&
    a.phase === b.phase &&
    a.status === b.status &&
    a.code === b.code &&
    a.ready === b.ready &&
    a.notice === b.notice
  )
}
