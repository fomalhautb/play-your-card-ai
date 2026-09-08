/**
 * 展示层（需求单弹窗 B）：把一张卡放大到屏幕正中，外加一层压暗的遮罩。
 *
 * 强制展示（对手打出的牌飞到中央翻正、停 1.5 秒）和放大查看（玩家点开一张卡）
 * **合成这一份**。旧版是两份实现（`MatchStage` 的展示层 + `CardZoomOverlay.tsx`），
 * 两边的遮罩、飞行时长、层级各写了一遍，改一处忘一处；需求单也把它们记成同一个变体。
 * 两条链路的区别只在"从哪儿飞来、飞到哪儿去"，那两个点由调用方给。
 *
 * 每段的时长全部 import `director/timings.ts`：进场 `REVEAL_IN_MS`（和放大查看的
 * `duration.card.zoomIn` 是同一个数）、停留 `REVEAL_HOLD_MS`、出场 `REVEAL_OUT_MS`、
 * 原地淡出 `REVEAL_FADE_OUT_MS`、强行收掉 `REVEAL_ABORT_MS`、遮罩淡出 `OVERLAY_OUT_MS`。
 *
 * 卡由调用方建也由调用方销毁——展示的那张牌在真场景里就是手牌或战场上原来那一张，
 * 这里只是把它借过来摆一会儿。所以 `enter` 收的是一个已经建好的 `CardSprite`。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import {
  OVERLAY_OUT_MS,
  REVEAL_ABORT_MS,
  REVEAL_FADE_OUT_MS,
  REVEAL_HOLD_MS,
  REVEAL_IN_MS,
  REVEAL_OUT_MS,
  REVEAL_POP_IN_MS,
} from '../director/timings'
import { CARD_HEIGHT } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import type { CardSprite } from './CardSprite'
import { Label } from './Label'

/** 字幕的字号和字距（px），以及它离卡底多远。组件私有，理由见 design 的 README。 */
const CAPTION = { fontSize: 20, letterSpacing: 4 } as const
const CAPTION_GAP = 28
/** 停留期间那条上下浮动：往上浮多少、一趟多久（秒）。抄 MatchStage.tsx:2447-2454。 */
const FLOAT_RISE = 8
const FLOAT_DUR = 1.15
/** 字幕淡入多久、起跑排在进场的百分之多少处。抄 MatchStage.tsx:2568-2577 的 `delay = 进场 × 0.6`。 */
const CAPTION_IN = 0.28
const CAPTION_DELAY_RATIO = 0.6

/** 卡从哪儿飞来 / 飞到哪儿去：位置加当时的缩放。 */
export interface RevealPoint {
  x: number
  y: number
  scale: number
}

export interface RevealOverlayDeps {
  text: TextTextureCache
  animator: Animator
}

export interface RevealOverlayOptions {
  /** 卡在中央放大到多少倍。不给就取令牌的常规档（英雄牌和触屏档由调用方另给）。 */
  scale?: number
}

export class RevealOverlay extends Container {
  private readonly deps: RevealOverlayDeps
  private readonly veil = new Graphics()
  /** 卡挂在这一层。层自己管位置和缩放，卡自己的 transform 留给它原来的用途。 */
  private readonly slot = new Container()
  private readonly captionSlot = new Container()
  private readonly zoom: number
  private card: CardSprite | null = null
  private boxWidth = 0
  private boxHeight = 0

  constructor(options: RevealOverlayOptions, deps: RevealOverlayDeps) {
    super()
    this.deps = deps
    this.zoom = options.scale ?? tokens.size.card.revealScale
    this.label = 'reveal-overlay'
    /*
     * 整层吃指针事件：强制展示期间点什么都不该有反应，而放大查看要靠"点遮罩关掉"。
     * 这一下是关还是没反应，由调用方挂不挂 `onDismiss` 决定，组件自己不判断。
     */
    this.eventMode = 'static'
    this.addChild(this.veil, this.slot, this.captionSlot)
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
      .fill({ color: tokens.color.overlay.reveal, alpha: tokens.opacity.overlay.reveal })
  }

  /** 屏幕正中那个点。调用方算飞行轨迹时要用。 */
  center(): RevealPoint {
    return { x: this.boxWidth / 2, y: this.boxHeight / 2, scale: this.zoom }
  }

  /**
   * 卡进场：从 `from` 飞到屏幕正中并放大。
   *
   * `from` 给 null 是**降级路径**——找不到起飞的那张牌（对手的技能牌在本端没有对应节点），
   * 改成在中央原地淡入，时长换成短一档的 `REVEAL_POP_IN_MS`。
   * 返回这一段的时长（毫秒），和 `reveal-enter` / `inspect-enter` cue 的 `durationMs` 一致。
   */
  enter(card: CardSprite, from: RevealPoint | null): number {
    this.card = card
    this.slot.removeChildren()
    this.slot.addChild(card)
    for (const child of this.captionSlot.removeChildren()) child.destroy({ children: true })
    this.visible = true

    const target = this.center()
    const duration = (from === null ? REVEAL_POP_IN_MS : REVEAL_IN_MS) / 1000
    const { animator } = this.deps
    /*
     * 卡的原点在**底边中点**（见 CardSprite 的坐标约定），所以让卡心落在屏幕正中，
     * 挂卡那一层要摆在正中往下半张卡的地方。半张卡的高按基准尺寸算，不问卡的包围盒——
     * 包围盒在倾斜和翻面期间每帧都在变，拿它算落点会让卡在飞的过程中飘。
     */
    const targetY = target.y + (CARD_HEIGHT * this.zoom) / 2

    animator.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration, ease: 'power2.out', overwrite: 'auto' },
    )
    if (from === null) {
      this.slot.position.set(target.x, targetY)
      this.slot.scale.set(this.zoom)
      animator.fromTo(this.slot, { alpha: 0 }, { alpha: 1, duration, ease: 'power2.out' })
      return REVEAL_POP_IN_MS
    }
    this.slot.alpha = 1
    this.slot.position.set(from.x, from.y)
    this.slot.scale.set(from.scale)
    animator.tween(this.slot, {
      x: target.x,
      y: targetY,
      duration,
      ease: 'power3.inOut',
      overwrite: 'auto',
    })
    animator.tween(this.slot.scale, {
      x: this.zoom,
      y: this.zoom,
      duration,
      ease: 'power3.inOut',
      overwrite: 'auto',
    })
    return REVEAL_IN_MS
  }

  /**
   * 强制观看的停留：卡上下浮一条，**不可跳过**。
   *
   * 浮动是 `repeat: -1` 的，自己不会停——`landTo` / `fade` / `abort` 都会先把它停掉。
   * 返回停留时长（毫秒），和 `reveal-hold` cue 的 `durationMs` 一致。
   */
  hold(): number {
    if (this.card === null) return 0
    const baseY = this.slot.y
    this.deps.animator.tween(this.slot, {
      y: baseY - FLOAT_RISE,
      duration: FLOAT_DUR,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
    return REVEAL_HOLD_MS
  }

  /**
   * 卡飞向某个落点（战场格子，或者放大查看关掉时飞回原位），遮罩跟着淡出。
   * 返回这一段的时长（毫秒），和 `reveal-land` / `inspect-exit` cue 的 `durationMs` 一致。
   */
  landTo(point: RevealPoint): number {
    if (this.card === null) return 0
    this.stopFloat()
    const duration = REVEAL_OUT_MS / 1000
    const { animator } = this.deps
    animator.tween(this.slot, {
      x: point.x,
      y: point.y,
      duration,
      ease: 'power2.inOut',
      overwrite: 'auto',
    })
    animator.tween(this.slot.scale, {
      x: point.scale,
      y: point.scale,
      duration,
      ease: 'power2.inOut',
      overwrite: 'auto',
    })
    /*
     * 遮罩比卡先收：卡要落回战场，遮罩还压着的话它是"落进一片暗里"。
     * 淡出排在整段的末尾对齐（`OVERLAY_OUT_MS` 比飞行短），卡快到位时背景已经亮回来了。
     */
    animator.tween(this, {
      alpha: 0,
      duration: OVERLAY_OUT_MS / 1000,
      delay: Math.max(0, duration - OVERLAY_OUT_MS / 1000),
      ease: 'power2.in',
      onComplete: () => this.settle(),
    })
    return REVEAL_OUT_MS
  }

  /**
   * 卡原地淡出（展示的技能牌没有落点）。
   * 返回时长（毫秒），和 `reveal-fade` cue 的 `durationMs` 一致。
   */
  fade(): number {
    this.stopFloat()
    const duration = REVEAL_FADE_OUT_MS / 1000
    this.deps.animator.tween(this, {
      alpha: 0,
      duration,
      ease: 'power2.in',
      overwrite: 'auto',
      onComplete: () => this.settle(),
    })
    return REVEAL_FADE_OUT_MS
  }

  /**
   * 强行收掉正在进行的展示：卡**直接消失**，只有遮罩自己淡掉。
   *
   * 只有答题阶段开始那一处会走到这里：结算层和展示层同一档层级，与其让两层打架，
   * 不如让展示让位——而展示本来要停 1.5 秒，等不起。
   * 返回时长（毫秒），和 `reveal-abort` cue 的 `durationMs` 一致。
   */
  abort(): number {
    this.stopFloat()
    this.slot.removeChildren()
    this.card = null
    this.deps.animator.tween(this, {
      alpha: 0,
      duration: REVEAL_ABORT_MS / 1000,
      ease: 'power2.in',
      overwrite: 'auto',
      onComplete: () => this.settle(),
    })
    return REVEAL_ABORT_MS
  }

  /**
   * 卡底下那行字（放大查看时说明这张牌是谁的、这是什么）。
   *
   * 起跑排在进场的六成处：卡还在飞的时候字就出来会抢注意力，飞到一半再上刚好。
   * 返回淡入时长（毫秒）。
   */
  showCaption(text: string): number {
    for (const child of this.captionSlot.removeChildren()) child.destroy({ children: true })
    const label = new Label(text, CAPTION, this.deps, tokens.color.battle.cueInk)
    label.alpha = 0
    label.position.set(this.boxWidth / 2, this.slot.y + CAPTION_GAP)
    this.captionSlot.addChild(label)
    this.deps.animator.tween(label, {
      alpha: 0.9,
      duration: CAPTION_IN,
      delay: (REVEAL_IN_MS / 1000) * CAPTION_DELAY_RATIO,
      ease: 'power2.out',
    })
    return Math.round(CAPTION_IN * 1000)
  }

  /** 现在展示着的那张卡，没有就是 null。调用方收尾时拿它放回原处。 */
  get shown(): CardSprite | null {
    return this.card
  }

  /** 停掉那条永不结束的浮动补间。不停的话帧循环会认为"还有东西在动"，永远停不下来（3.6）。 */
  private stopFloat(): void {
    this.deps.animator.killTweensOf(this.slot)
  }

  /** 一段收尾：整层藏起来，把卡还给调用方（摘出去但不销毁）。 */
  private settle(): void {
    this.visible = false
    this.alpha = 0
    this.slot.removeChildren()
    this.card = null
  }
}
