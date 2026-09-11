/**
 * 进度条（需求单条 A）：一条轨加一段填充，满了换个颜色。
 *
 * 构筑页那条「已选 N / 20」用它。纯显示，不吃指针事件。
 *
 * 填充走 Graphics 重画而不是缩一张精灵，是因为它两头都要圆角——缩精灵会把圆头压成椭圆。
 * 重画不违反 3.10：那条管的是**动画期间**别改几何，而这条进度只在加牌、删牌、
 * 换牌组时变一次，一秒钟顶多一两下，不在任何补间的路径上。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'

/** 轨和填充各多高。抄旧样式 `.deck-progress`（10.3）和 `.deck-progress__fill`（7.8）。 */
const TRACK_HEIGHT = 10
const FILL_HEIGHT = 8

export interface ProgressBarOptions {
  /** 整条多宽。由版式给。 */
  width: number
  /** 0~1。超出范围会被夹回来。 */
  value?: number
}

export class ProgressBar extends Container {
  readonly boxHeight = TRACK_HEIGHT

  private readonly track = new Graphics()
  private readonly fill = new Graphics()
  private barWidth: number
  private value = 0

  constructor(options: ProgressBarOptions) {
    super()
    this.barWidth = Math.max(0, options.width)
    // 纯显示，不吃指针事件——它压在牌组栏上，吃了下面的东西就点不着了。
    this.eventMode = 'none'
    this.addChild(this.track, this.fill)
    this.paintTrack()
    this.setValue(options.value ?? 0)
  }

  /** 整条多宽。改视口时调。 */
  get boxWidth(): number {
    return this.barWidth
  }

  resize(width: number): void {
    const next = Math.max(0, width)
    if (next === this.barWidth) return
    this.barWidth = next
    this.paintTrack()
    this.paint()
  }

  /**
   * 走到几成（0~1）。
   *
   * 到 1 的那一刻换成深绿：这是构筑页上「这副牌能上桌了」唯一的一眼信号，
   * 长度本身在最后一两张时看不出差别。
   */
  setValue(value: number): void {
    const next = Math.min(1, Math.max(0, value))
    if (next === this.value) return
    this.value = next
    this.paint()
  }

  private paintTrack(): void {
    this.track
      .clear()
      .roundRect(0, 0, this.barWidth, TRACK_HEIGHT, TRACK_HEIGHT / 2)
      .fill({ color: tokens.color.paper.shade })
      .stroke({ width: 1, color: tokens.color.paper.line })
  }

  private paint(): void {
    this.fill.clear()
    const inset = (TRACK_HEIGHT - FILL_HEIGHT) / 2
    const width = (this.barWidth - inset * 2) * this.value
    // 宽度不足一个圆头时干脆不画：画出来是一颗孤零零的圆点，看着像界面坏了。
    if (width < FILL_HEIGHT) return
    this.fill.roundRect(inset, inset, width, FILL_HEIGHT, FILL_HEIGHT / 2).fill({
      color: this.value >= 1 ? tokens.color.deck.progressFill : tokens.color.theme.gold,
    })
  }
}
