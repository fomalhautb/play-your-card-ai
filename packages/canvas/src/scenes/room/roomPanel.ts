/**
 * 房间页面板里那一摞东西：底板、标题、账号名、房间码、状态行、按钮、提示气泡。
 *
 * 和场景壳（RoomScene.ts）分开，是因为两者变化的理由不同：壳管渲染器、帧循环、
 * 视口和销毁，这里管「一份 `RoomView` 长什么样」。房间页往后要补图片底板和几颗次要按钮
 *（需求单的面板 L、按钮 G / H），改的都会是这个文件。
 *
 * ## 三层各自重建，尤其是**按钮那一层不跟着字走**
 *
 * 换文字一律是换 Label 对象（Label 建好之后没有能改内容的东西，同 TopBar 的做法），
 * 所以「字」那一层每变一次就整层重建——这一页一局只变几次，也不在动画期间，
 * 3.10 管的是稳态每帧，不是状态切换那一下。
 *
 * 但**按钮不能跟着一起重建**。这一页的状态有一半是对面推过来的（`room:peer`：他进房了、
 * 他准备了），随时可能在玩家按着某颗钮的那几毫秒里到达。跟着重建的话，那颗钮会在
 * pointerdown 和 pointerup 之间被销毁，松手时已经没人接了——表现就是「我点了准备，
 * 没反应」，而且只在对面恰好同时动作时才出现。所以按钮单独一层，
 * 只有**那一组钮本身变了**（哪几颗、印什么字、灰不灰）才重建。
 *
 * 拆的时候一律走 `killAndDestroy`（先掐补间再销毁）。这一页尤其绕不开它：
 * 触发重建的往往正是**刚被按下的那颗钮**——匾额按钮在 `onActivate` 之前就把
 * 弹回来那条补间建好了（见 PlaqueButton 的 `release`），而那条补间还带着一段 delay，
 * 要等几十毫秒才真正开始跑。它开跑的时候按钮早被这次重建拆掉了，
 * GSAP 于是在一个已经销毁的容器上取 `y`，当场抛 TypeError（见 runtime/dispose.ts）。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import { BUBBLE_TIP, Bubble } from '../../components/Bubble'
import { Label } from '../../components/Label'
import { PANEL_SIDEBAR, Panel } from '../../components/Panel'
import {
  PLAQUE_NAVY,
  PLAQUE_PAPER,
  PLAQUE_TERRACOTTA,
  PlaqueButton,
  type PlaqueButtonDeps,
  type PlaqueVariant,
} from '../../components/PlaqueButton'
import { killAndDestroy } from '../../runtime/dispose'
import type { RoomAction, RoomView } from './roomContract'

/** 面板想要多大，以及最少要留多少边。窄屏上按视口缩，但不缩到放不下按钮。 */
const PANEL = { width: 560, height: 400, margin: 32, minWidth: 340 }

/** 面板里从上往下几行的位置（相对面板顶边）和字号。 */
const ROWS = {
  title: { y: 34, fontSize: 26, letterSpacing: 6 },
  account: { y: 78, fontSize: tokens.font.size.lg, letterSpacing: 1 },
  /** 房间码那块大字。字号和字距抄需求单面板 L 那条（51.8px / 0.32em）。 */
  code: { y: 150, fontSize: 51.8, letterSpacing: 16.6 },
  status: { y: 226, fontSize: tokens.font.size.xl, letterSpacing: 1 },
} as const

/** 按钮那一摞：尺寸档、上下间距、离面板底边多远。 */
const BUTTONS = { size: 'endTurn', gapY: 14, gapX: 20, bottom: 30 } as const

/** 提示气泡摆在面板下面多远。 */
const NOTICE_GAP = 20

/** 这一页要用到的依赖，正好是匾额按钮那一份加一个 Bubble 要的 animator。 */
export type RoomPanelDeps = PlaqueButtonDeps

/** 一颗按钮的声明：印什么字、什么配色、按了发哪条操作、灰不灰。 */
interface ButtonSpec {
  caption: string
  variant: PlaqueVariant
  action: RoomAction
  disabled?: boolean
}

/**
 * 这一份状态该摆哪几颗钮。
 *
 * 三种 phase 的按钮组互不重叠，所以写成一个 switch 而不是一串 if——
 * 漏掉一种时类型检查会当场报出来。
 */
function buttonsOf(view: RoomView): ButtonSpec[] {
  switch (view.phase) {
    case 'idle':
      return [
        { caption: '匹配', variant: PLAQUE_NAVY, action: { kind: 'match' } },
        { caption: '开房', variant: PLAQUE_PAPER, action: { kind: 'create' } },
        { caption: '加入', variant: PLAQUE_PAPER, action: { kind: 'join' } },
      ]
    case 'busy':
      return [{ caption: '取消', variant: PLAQUE_PAPER, action: { kind: 'cancel' } }]
    case 'room': {
      const leave: ButtonSpec = {
        caption: '离开',
        variant: PLAQUE_TERRACOTTA,
        action: { kind: 'leave' },
      }
      if (view.ready === 'hidden') return [leave]
      return [
        {
          caption: view.ready === 'done' ? '已准备' : '准备',
          variant: PLAQUE_NAVY,
          action: { kind: 'ready' },
          // 点过就灰掉：服务端不收第二条 `room:ready`（回 `already-ready`），
          // 让钮还能按只会换来一句报错。
          disabled: view.ready === 'done',
        },
        leave,
      ]
    }
  }
}

/**
 * 面板里那一摞。它自己是个 Container，原点在面板左上角，由场景壳负责居中。
 */
export class RoomPanel extends Container {
  /** 面板本身的宽高，场景壳拿它算居中的位置。 */
  boxWidth = 0
  boxHeight = 0

  private readonly deps: RoomPanelDeps
  /** 几行字。每次变化整层重建。 */
  private readonly rows = new Container()
  /** 按钮。只有那一组钮本身变了才重建，理由见文件头。 */
  private readonly buttons = new Container()
  /** 提示气泡。 */
  private readonly notices = new Container()
  private plate: Panel
  private view: RoomView | null = null
  /** 上一次摆出来的那组钮的指纹。变了才重建。 */
  private buttonKey: string | null = null
  private onAction: ((action: RoomAction) => void) | null = null

  constructor(viewport: { width: number; height: number }, deps: RoomPanelDeps) {
    super()
    this.deps = deps
    this.label = 'room-panel'
    this.plate = this.makePlate(viewport)
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
    this.rebuildRows()
    this.rebuildButtons()
    if (before?.notice !== view.notice) this.rebuildNotice()
  }

  /** 视口变了：底板换一块新的（它的几何是建的时候画死的），内容整套重摆。 */
  resize(viewport: { width: number; height: number }): void {
    const index = this.getChildIndex(this.plate)
    this.removeChild(this.plate)
    killAndDestroy(this.deps.animator, this.plate)
    this.plate = this.makePlate(viewport)
    this.addChildAt(this.plate, index)
    // 尺寸变了，按钮的落点也变了，所以这一趟连按钮一起重建。
    this.buttonKey = null
    this.rebuildRows()
    this.rebuildButtons()
    this.rebuildNotice()
  }

  private makePlate(viewport: { width: number; height: number }): Panel {
    this.boxWidth = Math.max(
      PANEL.minWidth,
      Math.min(PANEL.width, viewport.width - PANEL.margin * 2),
    )
    this.boxHeight = Math.min(
      PANEL.height,
      Math.max(PANEL.height / 2, viewport.height - PANEL.margin * 2),
    )
    return new Panel(
      { variant: PANEL_SIDEBAR, width: this.boxWidth, height: this.boxHeight },
      this.deps,
    )
  }

  /** 清空一层，先掐补间再销毁（理由见文件头和 runtime/dispose.ts）。 */
  private clear(layer: Container): void {
    for (const child of layer.removeChildren()) killAndDestroy(this.deps.animator, child)
  }

  private rebuildRows(): void {
    this.clear(this.rows)
    const view = this.view
    if (view === null) return
    this.addRow('联机对战', ROWS.title, tokens.color.paper.ink, '600')
    if (view.account !== null) {
      this.addRow(view.account, ROWS.account, tokens.color.paper.inkMuted)
    }
    if (view.code !== null) {
      this.addRow(view.code, ROWS.code, tokens.color.paper.ink, '600')
    }
    if (view.status !== null) {
      this.addRow(view.status, ROWS.status, tokens.color.paper.inkMuted)
    }
  }

  private rebuildButtons(): void {
    const view = this.view
    if (view === null) return
    const specs = buttonsOf(view)
    // 指纹里带上全部会影响这几颗钮长相和行为的东西：印什么字、什么配色、灰不灰、发哪条操作。
    const key = specs
      .map(
        (spec) => `${spec.caption}|${spec.variant}|${spec.disabled === true}|${spec.action.kind}`,
      )
      .join(',')
    if (key === this.buttonKey) return
    this.buttonKey = key
    this.clear(this.buttons)
    this.addButtons(specs)
  }

  private rebuildNotice(): void {
    this.clear(this.notices)
    const notice = this.view?.notice
    if (notice === undefined || notice === null) return
    this.addNotice(notice)
  }

  /** 加一行居中的字。`maxWidth` 一律给面板宽减两边留白，长文案自己等比缩小。 */
  private addRow(
    content: string,
    row: { y: number; fontSize: number; letterSpacing: number },
    color: string,
    weight?: '600',
  ): void {
    const label = new Label(
      content,
      {
        fontSize: row.fontSize,
        letterSpacing: row.letterSpacing,
        maxWidth: this.boxWidth - PANEL.margin * 2,
        ...(weight === undefined ? {} : { weight }),
      },
      this.deps,
      color,
    )
    label.position.set(this.boxWidth / 2, row.y)
    this.rows.addChild(label)
  }

  /**
   * 把按钮摆好：一颗时居中，两颗时并排，三颗时竖着排。
   *
   * 三颗为什么不并排：一颗 184 宽，三颗加间距要 592，比面板还宽。
   * 竖排还有一个好处——「匹配」是主路，摆在最上面一眼就看得到。
   */
  private addButtons(specs: ButtonSpec[]): void {
    const buttons = specs.map((spec) => this.makeButton(spec))
    const [first] = buttons
    if (first === undefined) return
    const column = buttons.length > 2
    const bottom = this.boxHeight - BUTTONS.bottom

    if (column) {
      let y = bottom - buttons.length * first.boxHeight - (buttons.length - 1) * BUTTONS.gapY
      for (const button of buttons) {
        button.position.set((this.boxWidth - button.boxWidth) / 2, y)
        y += button.boxHeight + BUTTONS.gapY
      }
      return
    }

    const total =
      buttons.reduce((sum, button) => sum + button.boxWidth, 0) +
      (buttons.length - 1) * BUTTONS.gapX
    let x = (this.boxWidth - total) / 2
    for (const button of buttons) {
      button.position.set(x, bottom - button.boxHeight)
      x += button.boxWidth + BUTTONS.gapX
    }
  }

  private makeButton(spec: ButtonSpec): PlaqueButton {
    const button = new PlaqueButton(
      {
        variant: spec.variant,
        caption: spec.caption,
        size: BUTTONS.size,
        disabled: spec.disabled === true,
        onActivate: () => this.onAction?.(spec.action),
      },
      this.deps,
    )
    this.buttons.addChild(button)
    return button
  }

  /**
   * 提示气泡：挂在面板下方，建出来就淡入。
   *
   * 用提示 B（夜色药丸底）而不是错误红字 E：这一页的底是深色页面底，
   * 红字压在上面读不清，而 E 本来就是为压在战场上设计的（见 Bubble.ts）。
   */
  private addNotice(content: string): void {
    const bubble = new Bubble({ variant: BUBBLE_TIP, content, maxWidth: this.boxWidth }, this.deps)
    bubble.position.set((this.boxWidth - bubble.boxWidth) / 2, this.boxHeight + NOTICE_GAP)
    this.notices.addChild(bubble)
    // 建出来是藏着的（见 Bubble.ts），要自己叫一次淡入。
    bubble.show()
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
