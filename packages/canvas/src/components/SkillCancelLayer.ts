/**
 * 英雄技能抵消层：一个技能名大字加一行「谁抵消了谁的哪张牌」，没有别的元件。
 * 和抛硬币是同一档全屏过场（需求单弹窗 F 那一套壳），只是没有三维翻转要处理。
 *
 * 节奏抄旧版 `MatchStage.tsx:1509-1536`：
 * 层淡入 0.22 → 大字从 0.6 弹到原大（0.42，起跑 0.05）→ 说明从下方 16px 升上来
 *（0.3，起跑 0.28）→ 停 `CANCEL_HOLD` → 整层淡出 0.38。
 * 总长 import `SKILL_CANCEL_TOTAL_MS`，各段占的比例在下面的 PHASE 里。
 *
 * 两行字每次都不一样（技能名和那句说明跟着事件走），所以 `play` 一进来就把上一对丢掉、
 * 建新的——Label 建好之后没有能改内容的东西（见 Label.ts 的文件头）。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import { SKILL_CANCEL_TOTAL_MS } from '../director/timings'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/**
 * 两行字的字号和字距（px），以及说明那行最多多宽。组件私有，理由见 design 的 README。
 * 来源：styles.css 的 `.skill-cancel__title`（76px / 0.1em）和 `__text`（20px / 0.06em / 720）。
 */
const TYPE = {
  title: { fontSize: 76, letterSpacing: 7.6, weight: '700' },
  text: { fontSize: 20, letterSpacing: 1.2 },
} as const
const TEXT_MAX_WIDTH = 720
/** 两行之间留多宽。抄旧样式 `.skill-cancel` 的 `gap: 14px`。 */
const LINE_GAP = 14

/**
 * 各段占总时长的多少。旧版是 0.28 + 0.3（说明那段的起跑加时长，是淡出前最晚收的一段）
 * / 1.3（停）/ 0.38（淡出），加起来 2.26，正是 `SKILL_CANCEL_TOTAL_MS`。
 */
const TOTAL_SEC = 2.26
const PHASE = {
  veilIn: 0.22 / TOTAL_SEC,
  titleAt: 0.05 / TOTAL_SEC,
  titleDur: 0.42 / TOTAL_SEC,
  textAt: 0.28 / TOTAL_SEC,
  textDur: 0.3 / TOTAL_SEC,
  hold: 1.3 / TOTAL_SEC,
  out: 0.38 / TOTAL_SEC,
} as const
/** 大字从多小弹起来、说明从下方多远升上来。抄旧版的 `scale 0.6` 和 `y 16`。 */
const TITLE_FROM_SCALE = 0.6
const TEXT_RISE = 16

export interface SkillCancelDeps {
  text: TextTextureCache
  animator: Animator
}

export class SkillCancelLayer extends Container {
  private readonly deps: SkillCancelDeps
  private readonly veil = new Graphics()
  private readonly body = new Container()
  private boxWidth = 0
  private boxHeight = 0

  constructor(deps: SkillCancelDeps) {
    super()
    this.deps = deps
    this.label = 'skill-cancel'
    // 过场期间玩家什么都不能做，整层吃掉指针事件。
    this.eventMode = 'static'
    this.addChild(this.veil, this.body)
    this.visible = false
    this.alpha = 0
  }

  /** 遮罩要铺满整个视口，所以尺寸由调用方给。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.veil
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: tokens.color.overlay.veil, alpha: tokens.opacity.overlay.veil })
    this.layout()
  }

  /**
   * 播一遍。返回整段时长（毫秒），和 `skill-cancel` cue 的 `durationMs` 一致。
   * @param title 技能名，那个大字。
   * @param detail 一行「谁抵消了谁的哪张牌」。
   */
  play(title: string, detail: string): number {
    for (const child of this.body.removeChildren()) child.destroy({ children: true })
    const heading = new Label(title, TYPE.title, this.deps, tokens.color.battle.cueInk)
    const line = new Label(
      detail,
      { ...TYPE.text, maxWidth: TEXT_MAX_WIDTH },
      this.deps,
      tokens.color.battle.cueInk,
    )
    line.alpha = 0.88
    this.body.addChild(heading, line)
    this.layout()

    this.visible = true
    heading.scale.set(TITLE_FROM_SCALE)
    const total = SKILL_CANCEL_TOTAL_MS / 1000
    const timeline = this.deps.animator.timeline({
      onComplete: () => {
        this.visible = false
        this.alpha = 0
      },
    })
    timeline.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration: total * PHASE.veilIn, ease: 'power2.out' },
      0,
    )
    timeline.fromTo(
      heading,
      { alpha: 0 },
      { alpha: 1, duration: total * PHASE.titleDur, ease: 'back.out(2)' },
      total * PHASE.titleAt,
    )
    timeline.to(
      heading.scale,
      { x: 1, y: 1, duration: total * PHASE.titleDur, ease: 'back.out(2)' },
      total * PHASE.titleAt,
    )
    timeline.fromTo(
      line,
      { alpha: 0, y: line.y + TEXT_RISE },
      { alpha: 0.88, y: line.y, duration: total * PHASE.textDur, ease: 'power2.out' },
      total * PHASE.textAt,
    )
    timeline.to(
      this,
      { alpha: 0, duration: total * PHASE.out, ease: 'power2.in' },
      `+=${total * PHASE.hold}`,
    )
    return SKILL_CANCEL_TOTAL_MS
  }

  /** 当场收掉（对局中断时的 `clear-overlays`）。 */
  clear(): void {
    for (const target of [this as Container, ...this.body.children]) {
      this.deps.animator.killTweensOf(target)
      this.deps.animator.killTweensOf(target.scale)
    }
    this.visible = false
    this.alpha = 0
  }

  /** 两行字在视口正中上下排开。大字在上、说明在下，中间留一格。 */
  private layout(): void {
    const [heading, line] = this.body.children as Label[]
    if (heading === undefined || line === undefined) return
    const totalHeight = heading.textHeight + LINE_GAP + line.textHeight
    const top = (this.boxHeight - totalHeight) / 2
    heading.position.set(this.boxWidth / 2, top + heading.textHeight / 2)
    line.position.set(this.boxWidth / 2, top + heading.textHeight + LINE_GAP + line.textHeight / 2)
  }
}
