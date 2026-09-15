/**
 * 英雄技能抵消层：一个技能名大字加一行「谁抵消了谁的哪张牌」，没有别的元件。
 * 和抛硬币是同一档全屏过场（需求单弹窗 F 那一套壳），只是没有三维翻转要处理。
 *
 * 节奏抄旧版 `MatchStage.tsx:1509-1536`：
 * 层淡入 0.22 → 大字从 0.6 弹到原大（0.42，起跑 0.05）→ 说明从下方 16px 升上来
 *（0.3，起跑 0.28）→ 停 `CANCEL_HOLD` → 整层淡出 0.38。
 * 总长 import `SKILL_CANCEL_TOTAL_MS`，各段占的比例在下面的 PHASE 里。
 *
 * 两块方块每次印的都不一样（技能名和那句说明跟着事件走），所以 `play` 一进来就整对重建——
 * 素方块换字是换整张纹理，而这两块一局只出现几次，不在动画中间。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：76px 的大字和 20px 的说明
 * 各换成一块方块，时长和各段的比例一个数都没动。
 */

import { Container, Graphics } from 'pixi.js'
import { SKILL_CANCEL_TOTAL_MS } from '../director/timings'
import { VEIL } from '../fx/colors'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'

/** 两块方块各多大。宽按说明那行最长的一句留（旧样式 `.skill-cancel__text` 的 720）。 */
const TITLE_BOX = { width: 520, height: 88 } as const
const TEXT_BOX = { width: 720, height: 40 } as const
/** 两块之间留多宽。抄旧样式 `.skill-cancel` 的 `gap: 14px`。 */
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

export type SkillCancelDeps = BoxDeps & {
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
    this.veil.clear().rect(0, 0, width, height).fill({ color: VEIL.color, alpha: VEIL.alpha })
    this.layout()
  }

  /**
   * 播一遍。返回整段时长（毫秒），和 `skill-cancel` cue 的 `durationMs` 一致。
   * @param title 技能名，那个大字。
   * @param detail 一行「谁抵消了谁的哪张牌」。
   */
  play(title: string, detail: string): number {
    for (const child of this.body.removeChildren()) child.destroy({ children: true })
    const heading = new Box({ ...TITLE_BOX, label: title, size: 'title' }, this.deps)
    const line = new Box({ ...TEXT_BOX, label: detail }, this.deps)
    line.alpha = 0.88
    this.body.addChild(heading, line)
    this.layout()

    this.visible = true
    /*
     * 大字那一下是从小弹到原大，轴要放在它自己的中心：素方块的原点在左上角，
     * pivot 不挪的话弹起来会像整块往右下角甩。摆位时把 pivot 抵消回去（见 layout）。
     */
    heading.pivot.set(TITLE_BOX.width / 2, TITLE_BOX.height / 2)
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

  /**
   * 两块方块在视口正中上下排开。大字在上、说明在下，中间留一格。
   *
   * 大字那块的 pivot 在自己中心（见 play），所以它的 position 给的是中心点；
   * 说明那块没动 pivot，给的是左上角。
   */
  private layout(): void {
    const [heading, line] = this.body.children as Box[]
    if (heading === undefined || line === undefined) return
    const totalHeight = TITLE_BOX.height + LINE_GAP + TEXT_BOX.height
    const top = (this.boxHeight - totalHeight) / 2
    heading.position.set(this.boxWidth / 2, top + TITLE_BOX.height / 2)
    line.position.set((this.boxWidth - TEXT_BOX.width) / 2, top + TITLE_BOX.height + LINE_GAP)
  }
}
