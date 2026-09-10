/**
 * 结算层里一侧（我方 / 对方）的那一块：一行标头（阵营侧条、称呼、「正确 x / N」、
 * 「本轮领先」徽章）加下面横着排开的结果卡。
 *
 * 拆成单独一个文件不是因为它自成一个组件，而是因为 `SettleLayer` 装不下——
 * 单文件 400 行那条（7.2 第 3 条）卡着。所以它只对 `SettleLayer` 负责，不进包入口。
 *
 * 对应需求单：标签页 D（阵营侧条）、徽章 G（本轮领先）。
 * 旧版 `RoundSettleLayer.tsx` 里同名的那个组件就是这一块，切法照抄它。
 *
 * 标头是**整块重建**的：正确数一变就要换纹理，而 `Label` 建好之后改不了内容
 *（那是它有意做成这样的，见 Label 的文件头）。重建的时机只有两个——立起来那一下
 * 和结算那一下，都不在动画中间，不会撞上 3.5。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import { killAndDestroy } from '../runtime/dispose'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'
import type { SettleRow } from './SettleRow'

/**
 * 标头自己的几何和字号（px）。组件私有，理由见 design 的 README。
 * 来源：styles.css 的 `.settle__squad-tab`（5.2 宽）一族。
 */
const HEAD = { tabWidth: 6, height: 26, titleGap: 12, noteGap: 16, leadGap: 14, rowGap: 8 } as const
/** 同一排里两张结果卡之间至少留多宽。摆不下时它就是压边的下限，见 layout。 */
const CARD_GAP = 18
const TYPE = {
  head: { fontSize: tokens.font.size.lg, letterSpacing: 1.68 },
  lead: { fontSize: tokens.font.size.md, letterSpacing: 1.2 },
} as const
/** 领先徽章的内边距。抄需求单徽章 G（45×13、padding 2/10）。 */
const LEAD_PAD = { x: 10, y: 2 } as const

export interface SettleSquadDeps {
  text: TextTextureCache
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
    const title = new Label(
      this.mine ? '我方' : '对方',
      TYPE.head,
      this.deps,
      tokens.color.battle.ink,
    )
    title.position.set(HEAD.tabWidth + HEAD.titleGap + title.textWidth / 2, HEAD.height / 2)
    this.head.addChild(title)
    if (correct !== null) {
      const note = new Label(
        `正确 ${correct} / ${this.rowCount}`,
        TYPE.head,
        this.deps,
        tokens.color.battle.inkMuted,
      )
      note.position.set(
        title.x + title.textWidth / 2 + HEAD.noteGap + note.textWidth / 2,
        HEAD.height / 2,
      )
      this.head.addChild(note)
      if (leading) this.head.addChild(this.buildLead(note.x + note.textWidth / 2 + HEAD.leadGap))
    }
    // 阵营侧条：贴在结果卡这一排外侧的一条竖色带。
    const accent = this.mine ? tokens.color.theme.life : tokens.color.battle.lineDark
    this.head.addChild(
      new Graphics().rect(0, 0, HEAD.tabWidth, HEAD.height).fill({ color: accent }),
    )
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
    const cardWidth = rows[0]!.boxWidth
    const usable = width - padX * 2
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

  /** 「本轮领先」徽章：绿底白字的一小块。 */
  private buildLead(x: number): Container {
    const box = new Container()
    const label = new Label('本轮领先', TYPE.lead, this.deps, tokens.color.battle.paper)
    const width = Math.round(label.textWidth) + LEAD_PAD.x * 2
    const height = Math.round(label.textHeight) + LEAD_PAD.y * 2
    box.addChild(
      new Graphics()
        .roundRect(0, 0, width, height, tokens.radius.sm)
        .fill({ color: tokens.color.theme.forest }),
    )
    label.position.set(width / 2, height / 2)
    box.addChild(label)
    box.position.set(x, (HEAD.height - height) / 2)
    return box
  }
}
