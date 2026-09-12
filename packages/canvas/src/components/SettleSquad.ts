/**
 * 结算层里一侧（我方 / 对方）的那一块：一行标头（称呼、「正确 x / N」、「本轮领先」）
 * 加下面横着排开的结果卡。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：阵营侧条那条竖色带和
 * 绿底白字的领先徽章都换成描边方块。结果卡的宽也改回黑客松版那套**弹性**的——
 * 一侧几张就分几列，每列不窄于 `size.settle.cardMinWidth`，列间距 14。
 *
 * 拆成单独一个文件不是因为它自成一个组件，而是因为 `SettleLayer` 装不下——
 * 单文件 400 行那条（7.2 第 3 条）卡着。所以它只对 `SettleLayer` 负责，不进包入口。
 *
 * 对应需求单：标签页 D（阵营侧条）、徽章 G（本轮领先）。
 * 旧版 `RoundSettleLayer.tsx` 里同名的那个组件就是这一块，切法照抄它。
 *
 * 标头是**整块重建**的：正确数一变就要换纹理（素方块换字也是换整张）。
 * 重建的时机只有两个——立起来那一下和结算那一下，都不在动画中间，不会撞上 3.5。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import { killAndDestroy } from '../runtime/dispose'
import { Box, type BoxDeps } from './Box'
import type { SettleRow } from './SettleRow'

/** 标头那几格的尺寸。组件私有，理由见 design 的 README。 */
const HEAD = {
  height: 26,
  titleWidth: 72,
  noteWidth: 120,
  leadWidth: 88,
  gap: 12,
  rowGap: 8,
} as const
/** 同一排里两张结果卡之间留多宽。抄黑客松版 `.settle__cards` 的 `gap: 14px`。 */
const CARD_GAP = 14

export type SettleSquadDeps = BoxDeps & {
  animator: Animator
}

export class SettleSquad extends Container {
  private readonly deps: SettleSquadDeps
  /** 是不是「我方」那一侧。称呼和侧条的颜色都看它。 */
  private readonly mine: boolean
  private readonly head = new Container()
  private readonly column = new Container()

  constructor(side: 'mine' | 'theirs', deps: SettleSquadDeps) {
    super()
    this.deps = deps
    this.mine = side === 'mine'
    this.label = `settle-squad:${side}`
    this.eventMode = 'none'
    // 标头挂在卡列后面，画出来才压在卡上。两块在版面上并不重叠，这只是防手滑。
    this.addChild(this.column, this.head)
    this.setCounts(null, false)
  }

  /** 这一侧现在有几张结果卡。「正确 x / N」里的 N 就是它。 */
  get rowCount(): number {
    return this.column.children.length
  }

  /**
   * 收一张结果卡进来。卡由 `SettleLayer` 建也由它销毁——它才是按 rowId 认卡的那个。
   * 摆位不在这里做：新卡会挤动整排，得等调用方再调一次 `layout`。
   */
  addRow(row: SettleRow): void {
    this.column.addChild(row)
  }

  /**
   * 重建标头。`correct` 给 null 就只画称呼那一半——整层立起来那会儿还没人答题，
   * 「正确 0 / 0」比什么都不写更容易被当成「已经判完了，一张没对」。
   */
  setCounts(correct: number | null, leading: boolean): void {
    // 先掐补间再拆，理由见 runtime/dispose.ts 的文件头。
    for (const child of this.head.removeChildren()) killAndDestroy(this.deps.animator, child)
    let x = 0
    x = this.addCell(x, HEAD.titleWidth, this.mine ? '我方' : '对方')
    if (correct !== null) {
      x = this.addCell(x, HEAD.noteWidth, `正确 ${correct} / ${this.rowCount}`)
      if (leading) this.addCell(x, HEAD.leadWidth, '本轮领先')
    }
  }

  /** 标头里加一格，返回下一格的起点。 */
  private addCell(x: number, width: number, text: string): number {
    const cell = new Box({ width, height: HEAD.height, label: text, size: 'small' }, this.deps)
    cell.position.set(x, 0)
    this.head.addChild(cell)
    return x + width + HEAD.gap
  }

  /** 标头换成带正确数的那一版，整块淡入（`settle-counts` 那一下）。 */
  revealCounts(correct: number, leading: boolean, durationMs: number): void {
    this.setCounts(correct, leading)
    this.deps.animator.fromTo(
      this.head,
      { alpha: 0 },
      { alpha: 1, duration: durationMs / 1000, ease: 'power2.out', overwrite: 'auto' },
    )
  }

  /**
   * 摆位。这一块的原点由调用方放到它那半格的上沿，这里只管块内。
   *
   * `width` 是整层的设计宽度、`padX` 是它左右的留白：标头贴着左边留白起排，
   * 而卡是**整排在整层里居中**，两者的基准不一样，所以两个数都要传进来。
   */
  layout(width: number, padX: number): void {
    this.head.position.set(padX, 0)
    const rows = this.column.children as SettleRow[]
    if (rows.length === 0) return
    /*
     * 一侧的卡**横着排**，不是叠成一列。
     *
     * 结算层的高度是死的，一侧分到的那半格只装得下一张卡的高度；竖着排的话第二张
     * 就掉到另一侧的地盘里去了。旧版同理，它是靠 `--settle-cols` 按张数现算列数的。
     * 张数多到一行摆不下时压边（同战场那两排的处理），每张至少露出 `CARD_GAP` 那么宽。
     */
    /*
     * 列宽照黑客松版那条 `repeat(auto-fill, minmax(300px, 1fr))` 算：
     * 先看这一行**最多**摆得下几列（每列不窄于 `size.settle.cardMinWidth`、列距 14），
     * 再把宽度在这几列里平分。列数只看容器宽、不看这一侧有几张——
     * 只有一张时它也是那么宽的一列，不会独占整行。
     *
     * 不能拿 `rows[0].boxWidth` 当下限：那个数**已经被上一次摆位改过**（见 SettleRow.setWidth），
     * 拿它算下一次就会越算越宽，第二张卡到的时候两张会几乎重叠在一起。
     */
    const usable = width - padX * 2
    const minWidth = tokens.size.settle.cardMinWidth
    const columns = Math.max(1, Math.floor((usable + CARD_GAP) / (minWidth + CARD_GAP)))
    const cardWidth = (usable - CARD_GAP * (columns - 1)) / columns
    for (const row of rows) row.setWidth(cardWidth)

    const ideal = cardWidth + CARD_GAP
    const fit = rows.length <= 1 ? ideal : (usable - cardWidth) / (rows.length - 1)
    const step = Math.max(CARD_GAP, Math.min(ideal, fit))
    const rowY = HEAD.height + HEAD.rowGap
    const totalWidth = cardWidth + step * (rows.length - 1)
    const left = (width - totalWidth) / 2
    rows.forEach((row, index) => {
      row.position.set(left + index * step, rowY)
    })
  }
}
