/**
 * 结算层的上半截：顶栏（标题、三步进度条、轮次药丸、比分）和题目那一行
 *（题面 + 一条带宝石的竖分隔 + 标准答案框）。
 *
 * 拆成单独一个文件不是因为它自成一个组件，而是因为 `SettleLayer` 装不下——
 * 单文件 400 行那条（7.2 第 3 条）卡着。所以它只对 `SettleLayer` 负责，不进包入口。
 *
 * 对应需求单：列表 C（步骤条）、徽章 F（轮次药丸）、边框 F（分隔线加宝石）、
 * 面板 J（标准答案框）。
 *
 * 标准答案是**擦出来**的：内容先摆好，再拿一张白色精灵当遮罩、把它的 `scale.x`
 * 从 0 补到 1。不重画遮罩几何、每帧只改一个 transform（3.10）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { SETTLE_ANSWER_MS } from '../director/timings'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { DIVIDER_GEM, Divider } from './Divider'
import { Label } from './Label'

/**
 * 上半截自己的几何和字号（px）。组件私有，理由见 design 的 README。
 * 来源：styles.css 的 `.settle__*` 一族，以及需求单的徽章 F / 面板 J / 列表 C。
 */
const BAR = { height: 84, padX: 28 } as const
const ANSWER_PANEL = { width: 362, height: 166, pad: 26 } as const
const TYPE = {
  title: { fontSize: 28, letterSpacing: 1.68, weight: '700' },
  step: { fontSize: tokens.font.size.md, letterSpacing: 0 },
  pill: { fontSize: tokens.font.size.lg, letterSpacing: 1.68 },
  score: { fontSize: 22, letterSpacing: 0, weight: '700' },
  category: { fontSize: tokens.font.size.base, letterSpacing: 2.08 },
  question: { fontSize: 26, letterSpacing: 0 },
  answerLabel: { fontSize: tokens.font.size.base, letterSpacing: 2.08 },
  answerMain: { fontSize: 40, letterSpacing: 0, weight: '700' },
  answerExplain: { fontSize: tokens.font.size.lg, letterSpacing: 0 },
} as const
/** 轮次药丸和步骤标记的尺寸。抄需求单徽章 F（69×26）和列表 C（标记 13.8、连线 46）。 */
const PILL = { padX: 14, padY: 4 } as const
const STEP = { mark: 14, gap: 8, link: 46 } as const
/** 顶栏那三步。文案抄旧版 `RoundSettleLayer` 的 `STEP_LABELS`。 */
const STEPS = ['题目揭晓', 'AI 作答', '裁判结算'] as const

export interface SettleChromeDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export class SettleChrome extends Container {
  private readonly deps: SettleChromeDeps
  private readonly stepSlot = new Container()
  private readonly metaSlot = new Container()
  private readonly questionSlot = new Container()
  private readonly answerSlot = new Container()
  private readonly answerBody = new Container()
  private readonly answerMask = new Sprite(Texture.WHITE)
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

  /** 顶栏右端的轮次药丸和比分。比分一变就换纹理，所以整块重建。 */
  setMeta(round: number, mine: number, theirs: number): void {
    for (const child of this.metaSlot.removeChildren()) child.destroy({ children: true })
    const pill = this.buildPill(`第 ${round} 轮`)
    const score = this.buildScore(mine, theirs)
    score.x = this.boxWidth - BAR.padX - score.width
    pill.x = score.x - 16 - pill.width
    for (const part of [pill, score]) part.y = (BAR.height - part.height) / 2
    this.metaSlot.addChild(pill, score)
  }

  /**
   * 三步进度条走到第几步（0 起）。
   * 已完成的画实心勾、进行中的画实心点、还没到的画空圈——三档由这里的配色区分。
   */
  setStep(current: number): void {
    for (const child of this.stepSlot.removeChildren()) child.destroy({ children: true })
    let x = 0
    STEPS.forEach((text, index) => {
      if (index > 0) x += STEP.link
      const done = index < current
      const active = index === current
      const mark = new Graphics()
      const color = done || active ? tokens.color.theme.forest : tokens.color.battle.line
      mark.circle(0, 0, STEP.mark / 2).stroke({ width: 1, color })
      if (done || active) mark.circle(0, 0, STEP.mark / 2 - 3.5).fill({ color })
      mark.position.set(x + STEP.mark / 2, BAR.height / 2)
      const label = new Label(
        text,
        TYPE.step,
        this.deps,
        active ? tokens.color.battle.ink : tokens.color.battle.inkMuted,
      )
      label.position.set(x + STEP.mark + STEP.gap + label.textWidth / 2, BAR.height / 2)
      this.stepSlot.addChild(mark, label)
      x += STEP.mark + STEP.gap + label.textWidth
    })
    this.stepSlot.x = (this.boxWidth - x) / 2
  }

  /** 题面那一栏。答案框同时建好但压着（`answerBody.alpha = 0`），等 `revealAnswer` 擦出来。 */
  setQuestion(category: string, text: string): void {
    for (const child of this.questionSlot.removeChildren()) child.destroy({ children: true })
    const left = BAR.padX
    const width = this.boxWidth - ANSWER_PANEL.width - BAR.padX * 3 - 40
    const label = new Label(category, TYPE.category, this.deps, tokens.color.battle.inkMuted)
    label.position.set(left + label.textWidth / 2, BAR.height + 26)
    const body = new Label(
      text,
      { ...TYPE.question, align: 'left', maxWidth: width },
      this.deps,
      tokens.color.battle.ink,
    )
    body.position.set(left, BAR.height + 68)
    this.questionSlot.addChild(label, body)

    const gemX = left + width + 20
    const divider = new Divider(
      { variant: DIVIDER_GEM, length: ANSWER_PANEL.height, vertical: true },
      this.deps,
    )
    divider.position.set(gemX, BAR.height + 16)
    this.questionSlot.addChild(divider)
    this.rowBottom = BAR.height + 16 + ANSWER_PANEL.height + 24
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
      new Graphics()
        .roundRect(0, 0, ANSWER_PANEL.width, ANSWER_PANEL.height, tokens.radius.sm)
        .fill({ color: tokens.color.battle.paper })
        .stroke({ width: 2, color: tokens.color.theme.forest }),
    )
    const inner = ANSWER_PANEL.width - ANSWER_PANEL.pad * 2
    const tag = new Label('标准答案', TYPE.answerLabel, this.deps, tokens.color.theme.forest)
    tag.position.set(ANSWER_PANEL.pad + tag.textWidth / 2, ANSWER_PANEL.pad)
    const main = new Label(
      answer,
      { ...TYPE.answerMain, maxWidth: inner },
      this.deps,
      tokens.color.battle.ink,
    )
    main.position.set(ANSWER_PANEL.width / 2, ANSWER_PANEL.pad + 52)
    const note = new Label(
      explanation,
      { ...TYPE.answerExplain, maxWidth: inner },
      this.deps,
      tokens.color.battle.inkMuted,
    )
    note.position.set(ANSWER_PANEL.width / 2, ANSWER_PANEL.pad + 104)
    this.answerBody.addChild(tag, main, note)

    this.answerMask.setSize(ANSWER_PANEL.width, ANSWER_PANEL.height)
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

  /** 顶栏：标题在左，下沿一深一浅两条线（同对局顶栏的做法）。 */
  private buildBar(): Container {
    const bar = new Container()
    const title = new Label('出牌吧, AI', TYPE.title, this.deps, tokens.color.battle.ink)
    title.position.set(BAR.padX + title.textWidth / 2, BAR.height / 2)
    const lines = new Graphics()
      .rect(BAR.padX, BAR.height - 4, this.boxWidth - BAR.padX * 2, 1)
      .fill({ color: tokens.color.battle.lineDark })
      .rect(BAR.padX, BAR.height - 1, this.boxWidth - BAR.padX * 2, 1)
      .fill({ color: tokens.color.battle.line })
    bar.addChild(title, lines)
    return bar
  }

  /** 轮次药丸：一颗描边的圆头小牌。 */
  private buildPill(text: string): Container {
    const box = new Container()
    const label = new Label(text, TYPE.pill, this.deps, tokens.color.battle.inkMuted)
    const width = Math.round(label.textWidth) + PILL.padX * 2
    const height = Math.round(label.textHeight) + PILL.padY * 2
    box.addChild(
      new Graphics()
        .roundRect(0, 0, width, height, tokens.radius.pill)
        .fill({ color: tokens.color.battle.paper })
        .stroke({ width: 1, color: tokens.color.battle.lineDark }),
    )
    label.position.set(width / 2, height / 2)
    box.addChild(label)
    return box
  }

  /**
   * 比分：我方那个数压在一块深绿方块里，对方那个只上色。
   * 两边不对称是刻意的——这一层从头到尾都是"我"在看，自己的分要能一眼抓住。
   */
  private buildScore(mine: number, theirs: number): Container {
    const box = new Container()
    const size = 28
    box.addChild(
      new Graphics()
        .roundRect(0, 0, size, size, tokens.radius.sm)
        .fill({ color: tokens.color.theme.forest }),
    )
    const mineLabel = new Label(String(mine), TYPE.score, this.deps, tokens.color.battle.paper)
    mineLabel.position.set(size / 2, size / 2)
    const colon = new Label(':', TYPE.score, this.deps, tokens.color.battle.inkMuted)
    colon.position.set(size + 8, size / 2)
    const foe = new Label(String(theirs), TYPE.score, this.deps, tokens.color.theme.life)
    foe.position.set(size + 16 + size / 2, size / 2)
    box.addChild(mineLabel, colon, foe)
    return box
  }
}
