/**
 * 牌组那 20 个卡位（需求单列表 A 的**构筑档**；对局那一档是 BoardGrid）。
 *
 * 它管三件事：把 20 个格子的底画出来、把调用方给的卡摆进各自那一格、
 * 每格上挂一颗「－」用来移除。卡由**调用方建、调用方销毁**——同 BoardGrid 那边的分工，
 * 那些卡在场景里还要飞来飞去，组件只是借来摆一会儿。
 *
 * 20 颗「－」在建的时候就全建好，之后只切 `visible`：随建随销的话，每次加牌删牌都要
 * 新烤一遍圆章、新挂一次监听，而这一页恰恰是加删最频繁的地方。
 *
 * 让位（`setGap`）只改一格的底色，不动任何卡：拖拽途中让出来的那一格是**多插一个**，
 * 卡的位置由调用方按 `slotEntries` 算好再 `place` 进来（见 scenes/deck/logic/insert.ts）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import { CARD_HEIGHT } from '../layout/fanMath'
import { cellCount, cellRect, type GridSpec } from '../layout/gridMath'
import type { CardSprite } from './CardSprite'
import { SmallButton, type SmallButtonDeps } from './SmallButton'

/** 空格子里那圈虚线的实线段和空档各多长。 */
const DASH = { on: 5, off: 4 }
/**
 * 「－」那枚圆章占格宽的多少、最小最大多大，以及它离格子右上角多远。
 *
 * 跟着格宽走而不是写死一个数：两档版式的格子差得远（桌面六七十、手机七八十），
 * 写死的话在小格子上会盖掉小半张卡。
 */
const REMOVE = { ratio: 0.34, min: 16, max: 26, inset: 3 }

export type DeckSlotsDeps = SmallButtonDeps

export interface DeckSlotsOptions {
  grid: GridSpec
  /** 卡缩到多大（基准 150×225）。由版式给。 */
  cardScale: number
  /** 点了第 index 格上的「－」。 */
  onRemove?: (index: number) => void
}

export class DeckSlots extends Container {
  private readonly plate = new Graphics()
  /**
   * 让位那一格的金色高亮，**单独一层**。
   *
   * 不画在 `plate` 上是因为两者的重画频率差着数量级：20 个格子的底加一圈虚线是一千多条
   * 路径指令，而拖拽途中让位那一格几乎每挪一下就换一次。混在一起的话每换一次落点
   * 就要把一千多条指令重新攒一遍——6.9 那条「稳态每帧堆分配接近 0」当场顶穿
   *（实测就是被这一处顶到 17 KB/帧的）。分开之后换落点只重画一个格子。
   */
  private readonly highlight = new Graphics()
  /** 卡挂在这一层，压在格子底之上、「－」之下。 */
  private readonly cardLayer = new Container()
  private readonly removeLayer = new Container()
  private readonly removeButtons: SmallButton[] = []
  private grid: GridSpec
  private cardScale: number
  private gap: number | null = null
  /** 现在各格里坐着谁。只用来在换布局时把卡重新摆一遍，组件不持有它们的生命周期。 */
  private entries: (CardSprite | null)[] = []

  constructor(options: DeckSlotsOptions, deps: DeckSlotsDeps) {
    super()
    this.grid = options.grid
    this.cardScale = options.cardScale
    this.addChild(this.plate, this.highlight, this.cardLayer, this.removeLayer)

    for (let index = 0; index < cellCount(options.grid); index += 1) {
      const button = new SmallButton(
        {
          variant: 'J',
          glyph: 'minus',
          size: removeSizeOf(options.grid.cellWidth),
          onActivate: () => options.onRemove?.(index),
        },
        deps,
      )
      button.label = `deck-remove:${index}`
      button.visible = false
      this.removeLayer.addChild(button)
      this.removeButtons.push(button)
    }
    this.paint()
    this.placeButtons()
  }

  /**
   * 换网格或换卡的大小。
   *
   * 「－」的**直径**不跟着改：它是建的时候按格宽定的，改直径要重建那 20 颗圆章。
   * 场景那边改视口一律整套重建零件（见 DeckScene 的 resize），所以走不到「格子变了但钮没变」
   * 那个状态；这个方法只在建零件的最后摆一次位。
   */
  resize(grid: GridSpec, cardScale: number): void {
    this.grid = grid
    this.cardScale = cardScale
    this.paint()
    this.paintHighlight()
    this.placeButtons()
    this.place(this.entries)
  }

  /**
   * 把卡摆进各自那一格。`entries[i]` 是第 i 格里那张卡，`null` 就是空格。
   *
   * 组件**不建也不销毁**这些卡：调用方那边它们还要从卡池飞过来、飞回去。
   * 上一批里没再出现的那些会被摘出去（`removeChild`），交还给调用方处理。
   */
  place(entries: readonly (CardSprite | null)[]): void {
    const wanted = new Set(entries.filter((one): one is CardSprite => one !== null))
    for (const child of [...this.cardLayer.children]) {
      if (!wanted.has(child as CardSprite)) this.cardLayer.removeChild(child)
    }
    this.entries = [...entries]
    entries.forEach((card, index) => {
      const button = this.removeButtons[index]
      if (button !== undefined) button.visible = card !== null
      if (card === null) return
      const rect = cellRect(this.grid, index)
      card.scale.set(this.cardScale)
      /*
       * 卡的原点在**底边中点**（见 CardSprite 的坐标约定），所以要摆到格子的
       * 水平中线上、纵向贴着格子底边。
       */
      card.position.set(rect.x + rect.width / 2, rect.y + CARD_HEIGHT * this.cardScale)
      if (card.parent !== this.cardLayer) this.cardLayer.addChild(card)
    })
    // 尾巴上那些格子这一批没被提到，「－」一律收起来。
    for (let index = entries.length; index < this.removeButtons.length; index += 1) {
      const button = this.removeButtons[index]
      if (button !== undefined) button.visible = false
    }
  }

  /** 让位：把第 gap 格的底换成金色高亮。`null` 就是收掉。 */
  setGap(gap: number | null): void {
    if (gap === this.gap) return
    this.gap = gap
    this.paintHighlight()
  }

  /** 第 index 格的中心（这个容器自己的坐标）。飞行落点按它算。 */
  centerOf(index: number): { x: number; y: number } {
    const rect = cellRect(this.grid, index)
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }

  /** 卡在格子里缩到多大。调用方建卡时要用同一个数。 */
  get cardScaleNow(): number {
    return this.cardScale
  }

  private placeButtons(): void {
    this.removeButtons.forEach((button, index) => {
      const rect = cellRect(this.grid, index)
      button.position.set(
        rect.x + rect.width - button.boxWidth - REMOVE.inset,
        rect.y + REMOVE.inset,
      )
    })
  }

  /** 20 个格子的底：一层极淡的底加一圈虚线。只在换布局时画一次。 */
  private paint(): void {
    this.plate.clear()
    for (let index = 0; index < cellCount(this.grid); index += 1) {
      const rect = cellRect(this.grid, index)
      this.plate
        .roundRect(rect.x, rect.y, rect.width, rect.height, tokens.radius.sm)
        .fill({ color: tokens.color.paper.navy, alpha: tokens.opacity.deck.slotEmpty })
      dashedRoundRect(this.plate, rect)
      this.plate.stroke({ width: 1, color: tokens.color.paper.line })
    }
  }

  /**
   * 让位那一格：金底加一圈金虚线，压在原来那一格上。
   *
   * 虚线的分段是按同一套规则算的，所以它和底下那圈灰虚线**分毫不差地重合**，
   * 看上去就是那一格换了个颜色，不会露出两圈边。
   */
  private paintHighlight(): void {
    this.highlight.clear()
    if (this.gap === null) return
    const rect = cellRect(this.grid, this.gap)
    this.highlight
      .roundRect(rect.x, rect.y, rect.width, rect.height, tokens.radius.sm)
      .fill({ color: tokens.color.theme.gold, alpha: tokens.opacity.deck.gapHighlight })
    dashedRoundRect(this.highlight, rect)
    this.highlight.stroke({ width: 1, color: tokens.color.theme.gold })
  }
}

/** 「－」在这么宽的格子上该多大。 */
function removeSizeOf(cellWidth: number): number {
  return Math.min(REMOVE.max, Math.max(REMOVE.min, Math.round(cellWidth * REMOVE.ratio)))
}

/**
 * 一圈虚线。Pixi 的 Graphics 没有 dash 这回事，只能自己沿着四条边按
 *「实线段 + 空档」步进（同 SmallButton 里那颗虚线小钮）。四个角的圆角省掉——
 * 虚线本来就断着，少那点圆角看不出来，而画圆角要多算四段弧。
 */
function dashedRoundRect(
  graphics: Graphics,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const step = DASH.on + DASH.off
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const length = Math.hypot(x1 - x0, y1 - y0)
    const ux = (x1 - x0) / length
    const uy = (y1 - y0) / length
    for (let at = 0; at < length; at += step) {
      const end = Math.min(at + DASH.on, length)
      graphics.moveTo(x0 + ux * at, y0 + uy * at).lineTo(x0 + ux * end, y0 + uy * end)
    }
  }
  const l = rect.x + 0.5
  const t = rect.y + 0.5
  const r = rect.x + rect.width - 0.5
  const b = rect.y + rect.height - 0.5
  edge(l, t, r, t)
  edge(r, t, r, b)
  edge(r, b, l, b)
  edge(l, b, l, t)
}
