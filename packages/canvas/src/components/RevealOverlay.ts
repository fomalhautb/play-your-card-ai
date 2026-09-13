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
 * 这里只是把它借过来摆一会儿。所以 `enter` 收的是一个已经建好的显示对象。
 *
 * 收的是 `Container` 而不是 `CardSprite`：这一层只把交进来的东西挂上、挪位、缩放，
 * 不碰卡牌特有的任何方法。选英雄页放大的是一整张人物卡原画（名字画在图里，
 * 不该再套铭牌和费用圆章，见 duelContract 里 `CardTextures.heroes` 的说明），
 * 那是个普通精灵——限死成 CardSprite 只会逼出第二份一模一样的展示层。
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
import { Label } from './Label'

/** 字幕的字号和字距（px），以及它离卡底多远。组件私有，理由见 design 的 README。 */
const CAPTION = { fontSize: 20, letterSpacing: 4 } as const
const CAPTION_GAP = 28
/** 停留期间那条上下浮动往上浮多少。一趟多久走令牌（MatchStage.tsx:2447-2454）。 */
const FLOAT_RISE = 8
const FLOAT_DUR = tokens.duration.reveal.float
/** 字幕淡入多久走令牌；起跑排在进场的百分之多少处抄 MatchStage.tsx:2568-2577 的 `delay = 进场 × 0.6`。 */
const CAPTION_IN = tokens.duration.reveal.caption
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
  /**
   * 卡停在视口横向的哪一处（0 是左边、0.5 是正中、1 是右边）。不给就是正中。
   *
   * 选英雄页的详情浮层要它：那一版是「卡在左、说明在右」（需求单弹窗 C），
   * 卡摆在正中的话右边那一栏只能贴着屏幕边。字幕跟着这个锚点走，不另设一个。
   */
  anchorX?: number
  /**
   * 卡停在视口纵向的哪一处。不给就是正中。
   *
   * 对局页传 0.46，比正中略高一点，下方留给对方战场行，落场的飞行看着更顺
   *（抄黑客松版 `.reveal-card` 的 `top: 46%`）。
   */
  anchorY?: number
  /**
   * 遮罩的底色和不透明度。不给就是展示层那一档令牌（对局页和组牌页走它）。
   *
   * 选英雄页自己一档：那一页底下是七张高对比的人物原画，展示层那个 66% 压下去卡面还是亮的，
   * 技能说明压在人脸上读不了。抄黑客松 `.hero__detail-veil` 的 `rgb(5 8 12 / 82%)`
   *（那一版还叠了 14px 的背景模糊，这里没有——模糊要挂 Filter，纪律 3.1 不许）。
   */
  veil?: { color: number | string; alpha: number }
  /**
   * 顶上裁掉多高（0 就是不裁）。
   *
   * 对局页传顶栏的高度：强制展示的那张牌起飞时正停在对手手牌的位置，那张牌本来有一截
   * 被不透明的顶栏遮住，不裁的话点下去的第一帧那一截会突然画到顶栏上面，
   * 牌看着凭空长高一倍（黑客松版 `.reveal-clip` 那段注释讲的就是这件事）。
   *
   * 裁的是**这一层自己坐标里的一条水平线**，所以遮罩挂在这一层上、不跟着卡走。
   * 卡飞到中央之后整张都在这条线下面，裁不裁都一样，因此这里不像旧版那样飞完再撤掉。
   */
  topClip?: number
}

export class RevealOverlay extends Container {
  private readonly deps: RevealOverlayDeps
  private readonly veil = new Graphics()
  /** 卡挂在这一层。层自己管位置和缩放，卡自己的 transform 留给它原来的用途。 */
  private readonly slot = new Container()
  private readonly captionSlot = new Container()
  /**
   * 顶上那一刀。
   *
   * 是 Graphics 不是 Sprite：Pixi 按遮罩对象的类型挑实现，Sprite 走 AlphaMask
   *（先把被遮的东西画进一张离屏纹理再乘遮罩），而纪律 3.1 要求离屏渲染为 0。
   * Graphics 走的是 StencilMask，只写模板缓冲（同 SettleChrome 里那一处）。
   */
  private readonly clip: Graphics | null
  private readonly zoom: number
  /**
   * 这一趟放到多大。默认就是 `zoom`，`enter` 可以按这一张单独给。
   *
   * 侧栏那张英雄牌要单独给：它在面板里本来就有两百多宽，按普通卡那档 1.7 飞到中央
   * 反而比原位还小（黑客松同理，见 `--reveal-scale` 在 `.reveal-clip--hero` 上的覆盖）。
   */
  private activeZoom: number
  private readonly anchorX: number
  private readonly anchorY: number
  private readonly veilPaint: { color: number | string; alpha: number }
  private readonly topClip: number
  private card: Container | null = null
  private boxWidth = 0
  private boxHeight = 0

  constructor(options: RevealOverlayOptions, deps: RevealOverlayDeps) {
    super()
    this.deps = deps
    this.zoom = options.scale ?? tokens.size.card.revealScale
    this.activeZoom = this.zoom
    this.anchorX = options.anchorX ?? 0.5
    this.anchorY = options.anchorY ?? 0.5
    this.veilPaint = options.veil ?? {
      color: tokens.color.overlay.reveal,
      alpha: tokens.opacity.overlay.reveal,
    }
    this.topClip = options.topClip ?? 0
    this.clip = this.topClip > 0 ? new Graphics() : null
    this.label = 'reveal-overlay'
    /*
     * 整层吃指针事件：强制展示期间点什么都不该有反应，而放大查看要靠"点遮罩关掉"。
     * 这一下是关还是没反应，由调用方挂不挂 `onDismiss` 决定，组件自己不判断。
     */
    this.eventMode = 'static'
    this.addChild(this.veil, this.slot, this.captionSlot)
    if (this.clip !== null) {
      this.addChild(this.clip)
      this.slot.mask = this.clip
    }
    this.visible = false
    this.alpha = 0
  }

  /** 遮罩要铺满整个视口，所以尺寸由调用方给。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.veil.clear().rect(0, 0, width, height).fill(this.veilPaint)
    this.clip
      ?.clear()
      .rect(0, this.topClip, width, Math.max(0, height - this.topClip))
      .fill({ color: 0xffffff })
  }

  /** 卡停在哪个点（默认是屏幕正中，见 `anchorX` / `anchorY`）。调用方算飞行轨迹时要用。 */
  center(): RevealPoint {
    return {
      x: this.boxWidth * this.anchorX,
      y: this.boxHeight * this.anchorY,
      scale: this.activeZoom,
    }
  }

  /**
   * 卡进场：从 `from` 飞到屏幕正中并放大。
   *
   * `from` 给 null 是**降级路径**——找不到起飞的那张牌（对手的技能牌在本端没有对应节点），
   * 改成在中央原地淡入，时长换成短一档的 `REVEAL_POP_IN_MS`。
   * 返回这一段的时长（毫秒），和 `reveal-enter` / `inspect-enter` cue 的 `durationMs` 一致。
   *
   * @param zoom 这一趟放到多大，不给就用建层时定的那一档（见 `activeZoom`）。
   */
  enter(card: Container, from: RevealPoint | null, zoom?: number): number {
    this.activeZoom = zoom ?? this.zoom
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
    const targetY = target.y + (CARD_HEIGHT * this.activeZoom) / 2

    animator.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration, ease: 'power2.out', overwrite: 'auto' },
    )
    if (from === null) {
      this.slot.position.set(target.x, targetY)
      this.slot.scale.set(this.activeZoom)
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
      x: this.activeZoom,
      y: this.activeZoom,
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
    label.position.set(this.boxWidth * this.anchorX, this.slot.y + CAPTION_GAP)
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
  get shown(): Container | null {
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
