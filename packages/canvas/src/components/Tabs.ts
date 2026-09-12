/**
 * 一排页签：需求单的标签页 A（药丸卡组页签）、B（纸页签）、C（描边胶囊筛选）。
 *
 * 三个变体是**同一颗页签换三身皮**，不是三个组件——它们干的是同一件事：
 * 一排里选中一个，点另一个就换过去。差别只有底怎么画和字什么颜色，所以这里只有一个类，
 * 变体挑令牌、挑形状，不挑代码路径（同 PlaqueButton 那三档配色）。
 *
 * 选中态只改 tint 和 alpha，不重建任何对象（3.10）；换整排内容才重建
 *（每一项的字要现烤一张纹理，见 Label）。所以调用方**别每帧调 `setItems`**，
 * 只在牌组增删、筛选换档时调一次。
 *
 * 组件是哑的：它不知道「哪一项是当前牌组」，只知道「现在高亮第几个」。
 * 点了谁通过 `onSelect` 告诉调用方，选中态由调用方回头 `setSelected` 定——
 * 这样「点了但被拦下」不用在组件里开一条特例。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { TextTextureCache } from '../runtime/textCache'
import { Label, type LabelStyle } from './Label'

/** 编号变体。语义名见下面的别名常量，界面代码只在这几个里挑（7.1 第 2 条）。 */
export type TabsVariant = 'A' | 'B' | 'C'

export const TABS_DECK_PILL: TabsVariant = 'A'
export const TABS_PAPER: TabsVariant = 'B'
export const TABS_CHIP: TabsVariant = 'C'

/**
 * 每个变体的尺寸和字。
 *
 * 这三组字号字距**不进设计令牌**：它们是旧样式里就地写的中号字（12.5 / 14 / 13.5px），
 * 互不成阶梯、只服务这一个组件（同 PlaqueButton 的 `PLAQUE_TYPE`，理由见 design 的 README）。
 * 字距是把旧样式的 em 值乘开的结果：0.06em × 12.5px = 0.75，0.1em × 14px = 1.4，0.1em × 13.5px = 1.35。
 */
const SHAPES: Record<TabsVariant, { height: number; padX: number; radius: number } & LabelStyle> = {
  A: {
    height: 24,
    padX: 10,
    radius: tokens.radius.xs,
    fontSize: 12.5,
    weight: '600',
    letterSpacing: 0.75,
  },
  B: { height: 35, padX: 18, radius: 2, fontSize: 14, weight: '600', letterSpacing: 1.4 },
  C: {
    height: 26,
    padX: 14,
    radius: tokens.radius.pill,
    fontSize: 13.5,
    weight: '400',
    letterSpacing: 1.35,
  },
}

/** 每一项至少多宽。字短的那几项（「全部」「GPT」）不至于缩成一小坨。 */
const MIN_WIDTH = 56
/** 相邻两项之间留多宽。 */
const DEFAULT_GAP = 8

export interface TabItem {
  id: string
  label: string
}

export interface TabsDeps {
  text: TextTextureCache
}

export interface TabsOptions {
  variant: TabsVariant
  items?: readonly TabItem[]
  /** 一开始高亮哪一个。null 就是一个都不高亮。 */
  selectedId?: string | null
  /** 相邻两项之间留多宽，不给用默认值。 */
  gap?: number
  /** 点了某一项。禁用时不会被调到。 */
  onSelect?: (id: string) => void
}

/** 一项的位置和大小，调用方（和交互测试）拿它算命中点。 */
export interface TabRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface TabEntry {
  id: string
  /** 这一项印的字。用来判「这一排换内容了没有」，见 `sameItems`。 */
  label: string
  node: Container
  plate: Graphics
  text: Label
  width: number
}

export class Tabs extends Container {
  readonly variant: TabsVariant
  /** 整排占多宽多高。摆版式按它算。 */
  boxWidth = 0
  readonly boxHeight: number

  private readonly deps: TabsDeps
  private readonly gap: number
  private readonly onSelect: ((id: string) => void) | undefined
  private entries: TabEntry[] = []
  private selectedId: string | null
  private disabled = false

  constructor(options: TabsOptions, deps: TabsDeps) {
    super()
    this.variant = options.variant
    this.deps = deps
    this.gap = options.gap ?? DEFAULT_GAP
    this.onSelect = options.onSelect
    this.selectedId = options.selectedId ?? null
    this.boxHeight = SHAPES[options.variant].height
    this.setItems(options.items ?? [], this.selectedId)
  }

  /**
   * 换掉整排内容。
   *
   * 内容一模一样时**只换高亮的那一项**就返回：调用方（构筑页的 render.ts）是每次重排画面
   * 都无脑调一遍的，而这一排的内容其实很少变。不挡这一下的话，每翻一页、每拖一格都要
   * 把整排的字重烤一遍、把底重画一遍——6.9 那条「稳态每帧堆分配接近 0」当场顶穿
   *（实测就是被这一处顶到 32 KB/帧的）。
   *
   * 真的换内容时会重建每一项：字是烤成纹理的，换内容就得换一个 Label（见它的文件头）。
   */
  setItems(items: readonly TabItem[], selectedId: string | null = this.selectedId): void {
    if (this.sameItems(items)) {
      this.setSelected(selectedId)
      return
    }
    for (const child of this.removeChildren()) child.destroy({ children: true })
    this.entries = []
    this.selectedId = selectedId

    const shape = SHAPES[this.variant]
    let x = 0
    for (const item of items) {
      const label = new Label(
        item.label,
        { fontSize: shape.fontSize, weight: shape.weight, letterSpacing: shape.letterSpacing },
        this.deps,
      )
      const width = Math.max(MIN_WIDTH, Math.ceil(label.textWidth) + shape.padX * 2)
      const node = new Container()
      const plate = new Graphics()
      label.position.set(width / 2, shape.height / 2)
      node.addChild(plate, label)
      node.position.set(x, 0)
      node.eventMode = 'static'
      node.cursor = 'pointer'
      node.on('pointertap', () => {
        if (!this.disabled) this.onSelect?.(item.id)
      })
      this.addChild(node)
      this.entries.push({ id: item.id, label: item.label, node, plate, text: label, width })
      x += width + this.gap
    }
    this.boxWidth = Math.max(0, x - this.gap)
    this.paint()
  }

  /** 这一排现在装的是不是同一批内容（id 和字都一样）。 */
  private sameItems(items: readonly TabItem[]): boolean {
    if (items.length !== this.entries.length) return false
    return items.every(
      (item, index) =>
        this.entries[index]?.id === item.id && this.entries[index]?.label === item.label,
    )
  }

  /** 换高亮的那一项。只改 tint 和 alpha，一个对象都不重建（3.10）。 */
  setSelected(id: string | null): void {
    if (id === this.selectedId) return
    this.selectedId = id
    this.paint()
  }

  /** 现在高亮的是谁。 */
  get selected(): string | null {
    return this.selectedId
  }

  /** 整排点不点得动。灰着的时候整排压暗，点了没反应。 */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return
    this.disabled = disabled
    this.alpha = disabled ? tokens.opacity.control.idle : 1
    for (const entry of this.entries) entry.node.cursor = disabled ? 'default' : 'pointer'
  }

  /** 每一项在这个容器坐标里的矩形。命中点和交互测试按它算。 */
  rects(): TabRect[] {
    const { height } = SHAPES[this.variant]
    return this.entries.map((entry) => ({
      id: entry.id,
      x: entry.node.x,
      y: 0,
      width: entry.width,
      height,
    }))
  }

  /** 按当前选中态把每一项的底和字重画一遍。 */
  private paint(): void {
    for (const entry of this.entries) {
      const active = entry.id === this.selectedId
      entry.plate.clear()
      this.paintPlate(entry, active)
      entry.text.setColor(this.inkOf(active))
    }
  }

  private paintPlate(entry: TabEntry, active: boolean): void {
    const shape = SHAPES[this.variant]
    const box = { width: entry.width, height: shape.height, radius: shape.radius }
    switch (this.variant) {
      case 'A':
        // 药丸：选中才有底和描边，没选中的就是一行光秃秃的字。
        if (!active) return
        entry.plate
          .roundRect(0, 0, box.width, box.height, box.radius)
          .fill({ color: tokens.color.theme.rust, alpha: tokens.opacity.deck.tabActiveFill })
          .stroke({
            width: 1,
            color: tokens.color.theme.rust,
            alpha: tokens.opacity.deck.tabActiveLine,
          })
        return
      case 'B': {
        /*
         * 纸页签：像文件夹标签那样从纸面上翘起来，所以**只圆上面两个角**。
         * 旧样式那道朝上的投影（`box-shadow: 0 -2px 8px`）这里没有——3.1 不许挂 Filter，
         * 投影只能靠一张烤好的软边纹理，留到用得着的时候再说。
         */
        const radius = box.radius
        entry.plate
          .moveTo(0, box.height)
          .lineTo(0, radius)
          .arcTo(0, 0, radius, 0, radius)
          .lineTo(box.width - radius, 0)
          .arcTo(box.width, 0, box.width, radius, radius)
          .lineTo(box.width, box.height)
          .closePath()
          .fill({ color: active ? tokens.color.paper.base : tokens.color.paper.shade })
          .stroke({
            width: 1,
            color: active ? tokens.color.theme.gold : tokens.color.paper.line,
          })
        return
      }
      case 'C':
        // 描边胶囊：它压在夜色卡池的头部条上，没选中也留一圈淡边，不然一排字飘在深底上。
        entry.plate
          .roundRect(0.5, 0.5, box.width - 1, box.height - 1, box.radius)
          .fill({
            color: tokens.color.deck.chipInk,
            alpha: active ? tokens.opacity.deck.tabActiveFill : 0,
          })
          .stroke({
            width: 1,
            color: tokens.color.deck.chipInk,
            alpha: active ? tokens.opacity.deck.tabActiveLine : tokens.opacity.deck.chipLine,
          })
        return
    }
  }

  private inkOf(active: boolean): string {
    // 描边胶囊压在夜色底板上，字色一律是浅的；另外两档画在纸上，选中那项的墨更实一点。
    if (this.variant === 'C') return tokens.color.deck.chipInk
    return active ? tokens.color.paper.ink : tokens.color.paper.inkMuted
  }
}
