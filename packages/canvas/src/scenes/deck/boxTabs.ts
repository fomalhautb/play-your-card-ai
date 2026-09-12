/**
 * 一排素方块页签：构筑页上的种类页签、阵营药丸、牌组页签三处都是它。
 *
 * 从前这三处走 `components/Tabs.ts`（牌匾底、金赭双线、激活项高一截），
 * 正式版简化第 4 步之四把界面件剥成素方块之后，「一排可选的东西」只剩下
 *「一行方块，选中的那个亮着」这一件事，不值得再有一个带配色的组件。
 *
 * 选中与否只用**透明度**表达，不换颜色——换色就等于又开始定配色了（同 Box 的规矩）。
 * 整排禁用（技能牌那一页没有阵营可选）走 `Box.setDisabled`，它也是透明度，
 * 两者叠在一起就是「这排本来就不能点、里面还有一个是当前项」，看得出来。
 *
 * 每一格多宽按**字数**估，不去量纹理：Box 自己会把放不下的字整体缩一档，
 * 估宽只要保证「中文不挤、数字不空」就够。
 */

import { Container } from 'pixi.js'
import { Box, type BoxDeps } from '../../components/Box'

/** 一格里左右各留多宽，以及两格之间的空。 */
const PAD_X = 12
const GAP = 8
/** 估宽用：一个汉字算多宽、一个半角字符算多宽（对着 Box 的 body 档 16px 定的）。 */
const WIDE_CHAR = 17
const NARROW_CHAR = 9
/** 汉字、全角标点从这个码位起。比它小的按半角算。 */
const WIDE_FROM = 0x2e80
/** 没选中那几格压到多透明。 */
const IDLE_ALPHA = 0.45

export interface TabItem {
  id: string
  label: string
}

export interface BoxTabsOptions {
  /** 每一格多高。由版式给。 */
  height: number
  onSelect: (id: string) => void
}

/** 这一行字大概多宽。 */
function estimateWidth(label: string): number {
  let width = 0
  for (const char of label) {
    width += (char.codePointAt(0) ?? 0) >= WIDE_FROM ? WIDE_CHAR : NARROW_CHAR
  }
  return Math.round(width) + PAD_X * 2
}

export class BoxTabs extends Container {
  /** 这一排一共多宽多高。调用方摆版式时读它，别去读 `width` / `height`。 */
  boxWidth = 0
  readonly boxHeight: number

  private readonly deps: BoxDeps
  private readonly onSelect: (id: string) => void
  private readonly boxes: Box[] = []
  private ids: string[] = []
  private labels: string[] = []
  private disabled = false

  constructor(options: BoxTabsOptions, deps: BoxDeps) {
    super()
    this.deps = deps
    this.boxHeight = options.height
    this.onSelect = options.onSelect
  }

  /**
   * 换这一排的内容和当前项。
   *
   * 格数和文案都没变时只切一下透明度，一颗方块都不重建——切页签、加一张牌
   *（种类页签上的张数不跟着筛选变）都会走到这里，重建一次就是一排字重新烤。
   */
  setItems(items: readonly TabItem[], activeId: string): void {
    const sameShape =
      items.length === this.boxes.length &&
      items.every((one, index) => one.label === this.labels[index] && one.id === this.ids[index])
    if (!sameShape) this.rebuild(items)
    this.ids.forEach((id, index) => {
      const box = this.boxes[index]
      if (box !== undefined) box.alpha = id === activeId ? 1 : IDLE_ALPHA
    })
  }

  /** 整排点不点得动。 */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return
    this.disabled = disabled
    for (const box of this.boxes) box.setDisabled(disabled)
  }

  private rebuild(items: readonly TabItem[]): void {
    for (const box of this.removeChildren()) box.destroy({ children: true })
    this.boxes.length = 0
    this.ids = items.map((one) => one.id)
    this.labels = items.map((one) => one.label)
    let x = 0
    for (const item of items) {
      const width = estimateWidth(item.label)
      const box = new Box(
        { width, height: this.boxHeight, label: item.label, size: 'small' },
        this.deps,
      )
      box.onPress(() => this.onSelect(item.id))
      box.setDisabled(this.disabled)
      box.position.set(x, 0)
      this.addChild(box)
      this.boxes.push(box)
      x += width + GAP
    }
    this.boxWidth = Math.max(0, x - GAP)
  }
}
