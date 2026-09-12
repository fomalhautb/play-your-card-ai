/**
 * 回合结算全屏层：题目 + 标准答案 + 双方 AI 的作答 + 本轮计分 + 确认按钮。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：底纸、底栏那两行、
 * 确认那颗匾额按钮都换成描边方块。骨架（照 1672×941 排好再整块缩放）一点没动。
 *
 * 上半截（顶栏和题目那一行）在 `SettleChrome`，一侧的标头加那一排结果卡在 `SettleSquad`，
 * 一张结果卡在 `SettleRow`，拆开只是因为单文件 400 行那条卡着——四个文件合起来才是这一层。
 *
 * **一段演出一个方法，和 cue 一一对应**：`open` / `addRow` / `revealAnswer` / `typeRow` /
 * `stamp` / `showCounts` / `showScore` / `enableConfirm` / `exit` 依次对上
 * `settle-open` / `settle-row` / `settle-answer` / `settle-typing` / `settle-stamp` /
 * `settle-counts` / `settle-score` / `settle-confirm` / `settle-exit`。
 * 组件自己**不排期**：什么时候调哪一个由编排层的虚拟时钟说了算（`director/settleTimeline.ts`
 * 已经把整条线排好了），这里每个方法只管演自己那一段，并返回它演多久。
 *
 * 上下是**对方在上、我方在下**：自己那块贴着底栏的结论和确认按钮，
 * 视线从对面扫到自己、再落到「这一分算给了谁」，一路往下不用回头。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import {
  SETTLE_CONFIRM_MS,
  SETTLE_COUNTS_MS,
  SETTLE_EXIT_MS,
  SETTLE_OPEN_MS,
  SETTLE_ROW_IN_MS,
  SETTLE_SCORE_MS,
} from '../director/timings'
import type { Animator } from '../runtime/animator'
import { killAndDestroy } from '../runtime/dispose'
import { Box } from './Box'
import type { CardSprite } from './CardSprite'
import { SettleChrome, type SettleChromeDeps } from './SettleChrome'
import { SettleRow } from './SettleRow'
import { SettleSquad } from './SettleSquad'

/** 哪一侧。和 cue 里 `settle-row` 的 `mine` 是同一件事，换成有名字的写法。 */
export type SettleSide = 'mine' | 'theirs'

/**
 * 底栏自己的几何（px）。组件私有，理由见 design 的 README。
 * 来源：styles.css 的 `.settle__bottom`（96 高）。`padX` 同时是整层的左右留白，
 * 两侧的标头也贴着它起排（见 layoutSquads）。
 */
const BOTTOM = { height: 96, padX: 28 } as const
/** 底栏那两行各多高，以及确认那颗钮多大。 */
const BOTTOM_ROW = { spend: 26, verdict: 34, width: 520 } as const
const CONFIRM = { width: 180, height: 52 } as const
/**
 * 这一层的设计尺寸，也是旧版那块舞台的大小。
 *
 * 内容一律按它摆，再整块缩放到实际视口（见 resize）。需求单里结算层那批尺寸
 *（结果卡 444×154、答案框 362×166、顶栏 84、底栏 96）都是在这个尺寸下量的，
 * 换个基准就得把那一批全部重算。
 */
const DESIGN = { width: 1672, height: 941 } as const

/** 比分脉冲涨到多大。一趟多久走令牌（来回两趟，合起来正好是 SETTLE_SCORE_MS 的最后一段）。 */
const PULSE = { scale: 1.25, dur: tokens.duration.settle.scorePulse } as const
/** 整层退场缩到多小。抄旧版退场那段的 `scale 0.96`。 */
const EXIT_SCALE = 0.96

export interface SettleLayerDeps extends SettleChromeDeps {
  animator: Animator
}

export class SettleLayer extends Container {
  private readonly deps: SettleLayerDeps
  /** 内容全部按设计尺寸摆，整块再缩放到调用方给的大小（见 resize）。 */
  private readonly content = new Container()
  private readonly paper: Box
  private readonly chrome: SettleChrome
  private readonly squads: Record<SettleSide, SettleSquad>
  private readonly bottom = new Container()
  private readonly confirmSlot = new Container()
  private readonly rows = new Map<string, SettleRow>()
  private readonly boxWidth = DESIGN.width
  private readonly boxHeight = DESIGN.height
  /**
   * 这一轮是第几轮。
   *
   * 记着它是因为顶栏那块「轮次 + 比分」是一整块重建的（比分一变就要换纹理），
   * 而 `showScore` 只拿得到比分——重画时轮次得从这儿取，不然会掉回默认值。
   */
  private round = 1
  /** 视口有多大。退场时要按它把缩放的轴放到正中，见 exit。 */
  private viewWidth: number = DESIGN.width
  private viewHeight: number = DESIGN.height

  constructor(width: number, height: number, deps: SettleLayerDeps) {
    super()
    this.deps = deps
    this.label = 'settle-layer'
    // 整层吃指针事件：结算期间战场点不动，只有确认按钮能点。
    this.eventMode = 'static'
    this.paper = new Box({ width: DESIGN.width, height: DESIGN.height }, deps)
    this.chrome = new SettleChrome(DESIGN.width, deps)
    this.squads = { theirs: new SettleSquad('theirs', deps), mine: new SettleSquad('mine', deps) }
    this.content.addChild(
      this.paper,
      this.chrome,
      this.squads.theirs,
      this.squads.mine,
      this.bottom,
      this.confirmSlot,
    )
    this.addChild(this.content)
    this.resize(width, height)
    this.visible = false
    this.alpha = 0
  }

  /**
   * 整层缩放到给定的视口大小。
   *
   * 这一层和别的组件不一样：它不按新尺寸重排，而是**照设计尺寸排好再整块缩**。
   * 旧版也是这么做的（`RoundSettleLayer` 里那句「尺寸全是设计稿上的死数，
   * 再由 .battle-scaler 整体缩放」）。理由是这一层的内容互相咬得很死——
   * 题面栏、答案框、结果卡、底栏四块的高度加起来正好用完一屏，任何一块按比例重排
   * 都会让别的块的余量算错。缩放只是写一个 scale，属于 transform（3.10）。
   *
   * 等比缩放之后短边会有留白，所以整块还要在视口里居中。
   */
  resize(width: number, height: number): void {
    this.viewWidth = width
    this.viewHeight = height
    const scale = Math.min(width / DESIGN.width, height / DESIGN.height)
    this.content.scale.set(scale)
    this.content.position.set(
      (width - DESIGN.width * scale) / 2,
      (height - DESIGN.height * scale) / 2,
    )
  }

  /**
   * 整层立起来：题面亮出、双方的结果卡位摆好。
   * 返回时长（毫秒），和 `settle-open` cue 的 `durationMs` 一致。
   */
  open(
    question: { category: string; text: string },
    round: number,
    scoresBefore: { mine: number; theirs: number },
  ): number {
    this.clearRows()
    this.round = round
    this.chrome.setMeta(round, scoresBefore.mine, scoresBefore.theirs)
    this.chrome.setStep(0)
    this.chrome.setQuestion(question.category, question.text)
    for (const squad of Object.values(this.squads)) squad.setCounts(null, false)
    this.buildBottom(null)
    for (const child of this.confirmSlot.removeChildren()) this.drop(child)
    this.layoutSquads()

    this.visible = true
    const duration = SETTLE_OPEN_MS / 1000
    this.deps.animator.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration, ease: 'power2.out', overwrite: 'auto' },
    )
    this.deps.animator.fromTo(
      this.chrome,
      { y: -16 },
      { y: 0, duration, ease: 'power2.out', overwrite: 'auto' },
    )
    return SETTLE_OPEN_MS
  }

  /**
   * 新增一张结果卡（一条 `AI_ANSWERED` 一张），先只有卡名和「作答中」转圈。
   * 返回淡入时长（毫秒），和 `settle-row` cue 的 `durationMs` 一致。
   */
  addRow(rowId: string, name: string, card: CardSprite, side: SettleSide): number {
    if (this.rows.has(rowId)) return 0
    const row = new SettleRow(rowId, name, card, this.deps)
    this.rows.set(rowId, row)
    this.squads[side].addRow(row)
    this.layoutSquads()
    row.appear(SETTLE_ROW_IN_MS)
    return SETTLE_ROW_IN_MS
  }

  /** 标准答案从左往右擦出来。答案在本轮结算之后才公开，所以这一步不在 `open` 里。 */
  revealAnswer(answer: string, explanation: string): number {
    this.chrome.setStep(1)
    return this.chrome.revealAnswer(answer, explanation)
  }

  /** 一张结果卡开口作答：转圈淡出 → 大字答案打字 → 小字推理打字。 */
  typeRow(rowId: string, answer: string, reasoning: string, durationMs: number): number {
    this.rows.get(rowId)?.startTyping(answer, reasoning, durationMs)
    return durationMs
  }

  /** 一张结果卡盖判定章。 */
  stamp(rowId: string, correct: boolean, safePassed: boolean): number {
    return this.rows.get(rowId)?.stamp(correct, safePassed) ?? 0
  }

  /**
   * 两侧标头的「正确 x / N」淡入，「本轮领先」徽章弹一下。
   * 返回时长（毫秒），和 `settle-counts` cue 的 `durationMs` 一致。
   */
  showCounts(mine: number, theirs: number, leader: SettleSide | null): number {
    this.chrome.setStep(2)
    const counts = { mine, theirs }
    for (const side of ['mine', 'theirs'] as const) {
      this.squads[side].revealCounts(counts[side], leader === side, SETTLE_COUNTS_MS)
    }
    return SETTLE_COUNTS_MS
  }

  /**
   * 底栏：先交代消耗，再落下结论，最后顶栏比分才跳。
   * 三段首尾相接，加起来就是 `SETTLE_SCORE_MS`（那条常量的注释写着同一个算法）。
   */
  showScore(
    totals: { mine: number; theirs: number },
    spent: { mine: number; theirs: number },
    verdict: string,
  ): number {
    this.buildBottom({ spent, verdict })
    const total = SETTLE_SCORE_MS / 1000
    const [spendLine, verdictLine] = this.bottom.children as Container[]
    const timeline = this.deps.animator.timeline()
    if (spendLine !== undefined) {
      timeline.fromTo(spendLine, { alpha: 0 }, { alpha: 1, duration: total * 0.29 }, 0)
    }
    if (verdictLine !== undefined) {
      timeline.fromTo(verdictLine, { alpha: 0 }, { alpha: 1, duration: total * 0.38 }, total * 0.29)
    }
    // 比分那一跳排在最后：先说清楚发生了什么，再让数字动，玩家才跟得上因果。
    timeline.call(
      () => {
        this.chrome.setMeta(this.round, totals.mine, totals.theirs)
        this.pulseScore()
      },
      undefined,
      total * 0.67,
    )
    return SETTLE_SCORE_MS
  }

  /**
   * 确认按钮淡入。落地那一刻才可点——按钮先出来再变成能点的，玩家不会误以为卡住了。
   * 返回时长（毫秒），和 `settle-confirm` cue 的 `durationMs` 一致。
   */
  enableConfirm(onConfirm: () => void): number {
    for (const child of this.confirmSlot.removeChildren()) this.drop(child)
    const button = new Box({ ...CONFIRM, label: '确认' }, this.deps)
    button.setDisabled(true)
    button.onPress(onConfirm)
    button.position.set(
      (this.boxWidth - CONFIRM.width) / 2,
      this.boxHeight - BOTTOM.height / 2 - CONFIRM.height / 2,
    )
    button.alpha = 0
    this.confirmSlot.addChild(button)
    const duration = SETTLE_CONFIRM_MS / 1000
    this.deps.animator.fromTo(
      button,
      { alpha: 0 },
      {
        alpha: 1,
        duration,
        ease: 'power2.out',
        onComplete: () => button.setDisabled(false),
      },
    )
    return SETTLE_CONFIRM_MS
  }

  /**
   * 整层退场：淡出并微微缩小，战场重新露出来。
   *
   * 缩的是**外层**而不是 `content`：那一层的 scale 归 `resize` 管（把设计尺寸缩到视口），
   * 两处写同一个属性的话，退场一跑就把版式的缩放冲掉了。外层平时的 scale 是 1，
   * 退场用完再还原成 1。轴放在视口正中，整层才是"向内收"而不是"往左上角缩"。
   */
  exit(): number {
    const duration = SETTLE_EXIT_MS / 1000
    this.pivot.set(this.viewWidth / 2, this.viewHeight / 2)
    this.position.set(this.viewWidth / 2, this.viewHeight / 2)
    this.deps.animator.tween(this, {
      alpha: 0,
      duration,
      ease: 'power2.in',
      overwrite: 'auto',
      onComplete: () => {
        this.visible = false
        this.scale.set(1)
      },
    })
    this.deps.animator.tween(this.scale, {
      x: EXIT_SCALE,
      y: EXIT_SCALE,
      duration,
      ease: 'power2.in',
      overwrite: 'auto',
    })
    return SETTLE_EXIT_MS
  }

  /** 当场收掉（对局中断时的 `clear-overlays`）。 */
  clear(): void {
    this.deps.animator.killTweensOf(this)
    this.deps.animator.killTweensOf(this.scale)
    this.visible = false
    this.alpha = 0
    this.clearRows()
  }

  private clearRows(): void {
    for (const row of this.rows.values()) this.drop(row)
    this.rows.clear()
  }

  /**
   * 拆掉一个子节点：**先掐整棵子树的补间再拆**。
   *
   * 这一层里的东西几乎都在被补间：结算行是逐行升起来的、确认钮是淡入的、底栏两行随比分变。
   * 而它们的销毁时机（下一轮开场清上一轮的行、重新建确认钮）和补间的收尾是两条时钟上的事，
   * 直接 destroy 的话 GSAP 下一帧就会往一个已经拆掉的对象上写 y，当场抛错。
   * 完整理由见 runtime/dispose.ts 的文件头。
   */
  private drop(node: Container): void {
    killAndDestroy(this.deps.animator, node)
  }

  /** 底栏那两行：消耗和结论。传 null 就只占位不写字（`open` 那会儿还没算分）。 */
  private buildBottom(
    data: { spent: { mine: number; theirs: number }; verdict: string } | null,
  ): void {
    for (const child of this.bottom.removeChildren()) this.drop(child)
    const top = this.boxHeight - BOTTOM.height
    const spend = new Box(
      {
        width: BOTTOM_ROW.width,
        height: BOTTOM_ROW.spend,
        align: 'left',
        size: 'small',
        label:
          data === null
            ? '本轮消耗: —'
            : `本轮消耗: 我方 ${data.spent.mine} · 对方 ${data.spent.theirs}`,
      },
      this.deps,
    )
    spend.position.set(BOTTOM.padX, top + 12)
    const verdict = new Box(
      {
        width: BOTTOM_ROW.width,
        height: BOTTOM_ROW.verdict,
        align: 'left',
        label: data?.verdict ?? '',
      },
      this.deps,
    )
    verdict.position.set(BOTTOM.padX, top + 12 + BOTTOM_ROW.spend + 6)
    this.bottom.addChild(spend, verdict)
  }

  /** 顶栏比分跳一下。只跳「轮次 + 比分」那一小块，别的地方不动。 */
  private pulseScore(): void {
    this.chrome.pulseMeta(this.deps.animator, PULSE.scale, PULSE.dur)
  }

  /**
   * 两侧的位置：对方在上、我方在下，各占剩下那块高度的一半。
   * 块内怎么排（标头贴左、卡整排居中）归 `SettleSquad` 自己管。
   */
  private layoutSquads(): void {
    const top = this.chrome.rowBottom
    const half = (this.boxHeight - BOTTOM.height - top) / 2
    for (const [index, side] of (['theirs', 'mine'] as const).entries()) {
      const squad = this.squads[side]
      squad.position.set(0, top + index * half)
      squad.layout(this.boxWidth, BOTTOM.padX)
    }
  }
}
