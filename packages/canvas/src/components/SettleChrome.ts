/**
 * 结算层的上半截：顶栏（标题、三步进度、轮次和比分）和题目那一行（题面 + 标准答案框）。
 *
 * 拆成单独一个文件不是因为它自成一个组件，而是因为 `SettleLayer` 装不下——
 * 单文件 400 行那条（7.2 第 3 条）卡着。所以它只对 `SettleLayer` 负责，不进包入口。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：顶栏那两条线、三档圆点的
 * 步骤条、轮次药丸、深绿比分块、带宝石的竖分隔、答案框的绿描边全删了，一律换成描边方块。
 *
 * 标准答案仍然是**擦出来**的：内容先摆好，再拿一张遮罩把它的 `scale.x` 从 0 补到 1。
 * 不重画遮罩几何、每帧只改一个 transform（3.10）。
 */

import { Container, Graphics } from 'pixi.js'
import { SETTLE_ANSWER_MS } from '../director/timings'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'

/**
 * 上半截自己的几何（px）。组件私有，理由见 design 的 README。
 * 顶栏高 84、左右留白 28、答案框 362×166 都照旧，只是画法换成了方块。
 */
const BAR = { height: 84, padX: 28 } as const
const ANSWER_PANEL = { width: 362, height: 166, pad: 26 } as const
/** 顶栏上那几格各多大：标题、三步进度、轮次、比分。 */
const CELL = {
  title: { width: 180, height: 40 },
  step: { width: 120, height: 28, gap: 10 },
  round: { width: 96, height: 32 },
  score: { width: 96, height: 32 },
} as const
/** 顶栏那三步。文案抄旧版 `RoundSettleLayer` 的 `STEP_LABELS`。 */
const STEPS = ['题目揭晓', 'AI 作答', '裁判结算'] as const
/** 题面和答案框里那几格的尺寸。 */
const QUESTION = { categoryHeight: 28, bodyHeight: 110, gap: 12 } as const
const ANSWER_ROW = { tag: 26, main: 56, note: 48, gap: 8 } as const

export type SettleChromeDeps = BoxDeps & {
  animator: Animator
}

export class SettleChrome extends Container {
  private readonly deps: SettleChromeDeps
  private readonly stepSlot = new Container()
  private readonly metaSlot = new Container()
  private readonly questionSlot = new Container()
  private readonly answerSlot = new Container()
  private readonly answerBody = new Container()
  /**
   * 擦出答案框那一层的遮罩。
   *
   * 是 Graphics 不是 Sprite：Pixi 按遮罩对象的类型挑实现，Sprite 走 AlphaMask
   *（先把被遮的东西画进一张离屏纹理再乘遮罩），而纪律 3.1 要求离屏渲染为 0。
   * Graphics 走的是 StencilMask，只写模板缓冲。理由同 SettleRow 里那一处。
   */
  private readonly answerMask = new Graphics()
  private boxWidth: number
  /** 题目那一行占多高。`SettleLayer` 要拿它算下面结果卡区的起点。 */
  rowBottom: number = BAR.height

  constructor(width: number, deps: SettleChromeDeps) {
    super()
    this.deps = deps
    this.boxWidth = width
    this.eventMode = 'none'
    this.addChild(this.buildBar(), this.stepSlot, this.metaSlot, this.questionSlot, this.answerSlot)
    this.setStep(0)
  }

  /** 顶栏右端的轮次和比分。比分一变就换纹理，所以整块重建。 */
  setMeta(round: number, mine: number, theirs: number): void {
    for (const child of this.metaSlot.removeChildren()) child.destroy({ children: true })
    const score = new Box({ ...CELL.score, label: `${mine} : ${theirs}`, size: 'small' }, this.deps)
    const pill = new Box({ ...CELL.round, label: `第 ${round} 轮`, size: 'small' }, this.deps)
    score.x = this.boxWidth - BAR.padX - CELL.score.width
    pill.x = score.x - 16 - CELL.round.width
    score.y = (BAR.height - CELL.score.height) / 2
    pill.y = (BAR.height - CELL.round.height) / 2
    this.metaSlot.addChild(pill, score)
  }

  /**
   * 顶栏右端那块「轮次 + 比分」跳一下。
   *
   * 轴放在这块自己的中心：pivot 留在左上角的话，跳起来会像整块往右下角甩出去。
   * 跳的是 scale，属于 transform（3.10）。
   */
  pulseMeta(animator: Animator, scale: number, duration: number): void {
    const bounds = this.metaSlot.getLocalBounds()
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    this.metaSlot.pivot.set(centerX, centerY)
    this.metaSlot.position.set(centerX, centerY)
    const timeline = animator.timeline()
    timeline.to(this.metaSlot.scale, { x: scale, y: scale, duration, ease: 'power2.out' })
    timeline.to(this.metaSlot.scale, { x: 1, y: 1, duration, ease: 'power2.in' })
  }

  /**
   * 三步进度条走到第几步（0 起）。
   * 已完成的画实心勾、进行中的画实心点、还没到的画空圈——三档由这里的配色区分。
   */
  setStep(current: number): void {
    for (const child of this.stepSlot.removeChildren()) child.destroy({ children: true })
    /*
     * 三档从前靠配色分（空圈 / 空圈套点 / 实心），素方块只有「点得动」和「点不动」两档，
     * 所以改成：还没到的那几步压暗，已完成和进行中的是实的。
     * 这一条在画面上仍然回答「走到第几步了」，只是分辨力从三档掉到两档。
     */
    STEPS.forEach((text, index) => {
      const cell = new Box({ ...CELL.step, label: text, size: 'small' }, this.deps)
      cell.setDisabled(index > current)
      cell.position.set(
        index * (CELL.step.width + CELL.step.gap),
        (BAR.height - CELL.step.height) / 2,
      )
      this.stepSlot.addChild(cell)
    })
    const total = STEPS.length * CELL.step.width + (STEPS.length - 1) * CELL.step.gap
    this.stepSlot.x = (this.boxWidth - total) / 2
  }

  /** 题面那一栏。答案框同时建好但压着，等 `revealAnswer` 擦出来。 */
  setQuestion(category: string, text: string): void {
    for (const child of this.questionSlot.removeChildren()) child.destroy({ children: true })
    const left = BAR.padX
    const width = this.boxWidth - ANSWER_PANEL.width - BAR.padX * 3 - 40
    const top = BAR.height + 16
    const categoryBox = new Box(
      { width, height: QUESTION.categoryHeight, label: category, align: 'left', size: 'small' },
      this.deps,
    )
    categoryBox.position.set(left, top)
    const body = new Box(
      { width, height: QUESTION.bodyHeight, label: text, align: 'left' },
      this.deps,
    )
    body.position.set(left, top + QUESTION.categoryHeight + QUESTION.gap)
    this.questionSlot.addChild(categoryBox, body)
    this.rowBottom = top + ANSWER_PANEL.height + 24
  }

  /**
   * 标准答案从左往右擦出来。
   * 返回时长（毫秒），和 `settle-answer` cue 的 `durationMs` 一致。
   */
  revealAnswer(answer: string, explanation: string): number {
    this.answerSlot.removeChildren()
    for (const child of this.answerBody.removeChildren()) child.destroy({ children: true })
    const x = this.boxWidth - BAR.padX - ANSWER_PANEL.width
    const y = BAR.height + 16
    this.answerSlot.position.set(x, y)

    this.answerBody.addChild(
      new Box({ width: ANSWER_PANEL.width, height: ANSWER_PANEL.height }, this.deps),
    )
    const inner = ANSWER_PANEL.width - ANSWER_PANEL.pad * 2
    let rowY = ANSWER_PANEL.pad
    for (const [height, label, size] of [
      [ANSWER_ROW.tag, '标准答案', 'small'],
      [ANSWER_ROW.main, answer, 'title'],
      [ANSWER_ROW.note, explanation, 'small'],
    ] as const) {
      const row = new Box({ width: inner, height, label, size }, this.deps)
      row.position.set(ANSWER_PANEL.pad, rowY)
      this.answerBody.addChild(row)
      rowY += height + ANSWER_ROW.gap
    }

    // 遮罩按满格尺寸画好，再把横向缩放从 0 补到 1，就是「从左往右擦出来」。
    this.answerMask
      .clear()
      .rect(0, 0, ANSWER_PANEL.width, ANSWER_PANEL.height)
      .fill({ color: 0xffffff })
    this.answerMask.scale.x = 0
    this.answerSlot.addChild(this.answerBody, this.answerMask)
    this.answerBody.mask = this.answerMask
    this.deps.animator.tween(this.answerMask.scale, {
      x: 1,
      duration: SETTLE_ANSWER_MS / 1000,
      ease: 'power2.out',
      overwrite: 'auto',
    })
    return SETTLE_ANSWER_MS
  }

  /** 顶栏：标题那一格贴左。 */
  private buildBar(): Container {
    const bar = new Container()
    const title = new Box({ ...CELL.title, label: '出牌吧, AI' }, this.deps)
    title.position.set(BAR.padX, (BAR.height - CELL.title.height) / 2)
    bar.addChild(title)
    return bar
  }
}
