/**
 * 三颗小按钮：需求单的按钮 H（图标加文字钮）、J（夜色圆章图标钮）、L（线框小钮）。
 *
 * 它们和匾额按钮（`PlaqueButton` 的 A~C、K）**不是同一件东西**：匾额是全站的主操作键，
 * 由五张预烤纹理叠出一块有厚度的板；这三颗都是「一笔线加一行字」的轻按钮，
 * 各自只有一两个图形。合成一个组件是因为它们的**行为**完全一样——
 * 悬停亮一点、按下缩一点、禁用压暗、松手且指针还在上面才算点了一下，
 * 分成三个类就是把同一套状态机抄三遍。
 *
 * 三个变体各挑各的形状和令牌，不挑代码路径。所有状态变化只写 alpha 和 scale，
 * 一个对象都不重建（3.10）。
 */

import { tokens } from '@ai-duel/design'
import type { Platform, SoundSpec } from '@ai-duel/platform'
import { Container, Graphics, Rectangle, Sprite } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量，界面代码只在这几个里挑（7.1 第 2 条）。 */
export type SmallButtonVariant = 'H' | 'J' | 'L'

export const SMALL_BACK: SmallButtonVariant = 'H'
export const SMALL_SEAL: SmallButtonVariant = 'J'
export const SMALL_WIRE: SmallButtonVariant = 'L'

/** 圆章里那枚字形。加牌是「＋」、移除是「－」。 */
export type SealGlyph = 'plus' | 'minus'

/**
 * 各变体的字号字距。**不进设计令牌**，理由同 `PlaqueButton` 的 `PLAQUE_TYPE`：
 * 旧样式里就地写的中号字，互不成阶梯、只服务这一个组件（见 design 的 README）。
 * 字距按旧样式的 em 值乘开：0.1em × 19px = 1.9，0.08em × 12px = 0.96。
 */
const TYPE = {
  H: { fontSize: 19, letterSpacing: 1.9, weight: '400', align: 'left' },
  L: { fontSize: 12, letterSpacing: 0.96, weight: '600' },
} as const

/** 返回箭头的画布（抄旧版那枚内联 SVG 的 viewBox 0 0 23 15）和线粗。 */
const ARROW = { width: 23, height: 15, line: 1.3 }
/** 箭头和后面那行字之间留多宽。 */
const ARROW_GAP = 8
/** 圆章的默认直径，以及里面那枚字形占直径的多少、笔画多粗。 */
const SEAL = { size: 34, glyphRatio: 0.44, glyphLine: 2 }
/** 线框小钮左右各留多少、多高，以及虚线那一档的实线段和空档各多长。 */
const WIRE = { padX: 10, height: 24, dash: 3, gap: 3 }

/** 按下时缩到多小。比匾额那一下轻——这几颗本来就小，压太狠会看着像抖了一下。 */
const PRESS_SCALE = 0.94

export interface SmallButtonDeps {
  ui: UiTextures
  text: TextTextureCache
  /** 补间的唯一入口。按下和弹回都从这儿建，帧循环才推得动、也才停得下来（3.6）。 */
  animator: Animator
  /** 触感和音效走它。谁都不直接碰浏览器 API（第 2 节第 5 条）。 */
  platform: Pick<Platform, 'audio' | 'haptics'>
  /** 按下时放的那一声。资源地址不归 canvas 管，由调用方给；给 null 就不出声。 */
  clickSound: SoundSpec | null
}

export interface SmallButtonOptions {
  variant: SmallButtonVariant
  /** H、L 用：钮上印的字。 */
  caption?: string
  /** J 用：圆章里那枚字形，默认「＋」。 */
  glyph?: SealGlyph
  /**
   * 笔画和字的颜色。**由使用方给**——同一颗返回钮在夜色页上是金的、在纸面页上是墨的
   *（需求单按钮 H 明写「颜色由使用方给」）。不给按变体取一个合理的默认值。
   */
  ink?: string
  /** J 用：圆章直径，不给用默认值。 */
  size?: number
  /** L 用：框画成虚线（构筑页那颗「新建牌组」就是虚线的）。 */
  dashed?: boolean
  disabled?: boolean
  onActivate?: () => void
}

export class SmallButton extends Container {
  readonly variant: SmallButtonVariant
  readonly boxWidth: number
  readonly boxHeight: number

  /** 按下时整块缩的那一层。按钮自己的 transform 留给调用方摆版式，两边互不覆盖。 */
  private readonly inner = new Container()
  private readonly deps: SmallButtonDeps
  private readonly onActivate: (() => void) | undefined
  private disabled: boolean
  private hovering = false

  constructor(options: SmallButtonOptions, deps: SmallButtonDeps) {
    super()
    this.variant = options.variant
    this.deps = deps
    this.onActivate = options.onActivate
    this.disabled = options.disabled === true
    const ink = options.ink ?? defaultInk(options.variant)

    const size =
      options.variant === 'J'
        ? buildSeal(this.inner, deps, options.glyph ?? 'plus', options.size ?? SEAL.size, ink)
        : options.variant === 'H'
          ? buildBack(this.inner, deps, options.caption ?? '返回', ink)
          : buildWire(this.inner, deps, options.caption ?? '', ink, options.dashed === true)
    this.boxWidth = size.width
    this.boxHeight = size.height

    // 缩放以中心为支点：pivot 放到正中，再把整层挪回去。
    this.inner.pivot.set(size.width / 2, size.height / 2)
    this.inner.position.set(size.width / 2, size.height / 2)
    this.addChild(this.inner)

    this.eventMode = 'static'
    this.cursor = this.disabled ? 'default' : 'pointer'
    /*
     * 命中区显式给成整块矩形，不让 Pixi 按子节点包围盒算：按下那一下会把内层缩小，
     * 包围盒跟着变，命中区一抖指针就可能「滑出」按钮，松手时点不着。
     */
    this.hitArea = new Rectangle(0, 0, size.width, size.height)
    this.bindPointer()
    this.applyState()
  }

  /** 点不点得动。禁用时连悬停都不响应。 */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return
    this.disabled = disabled
    this.cursor = disabled ? 'default' : 'pointer'
    this.applyState()
  }

  /** 把某一态直接摆出来（目录页要拍「悬停」「按下」这两张，没有真指针可用）。 */
  showState(state: 'default' | 'hover' | 'pressed' | 'disabled'): void {
    this.disabled = state === 'disabled'
    this.hovering = state === 'hover'
    this.applyState()
    this.inner.scale.set(state === 'pressed' ? PRESS_SCALE : 1)
  }

  private bindPointer(): void {
    this.on('pointerover', () => {
      this.hovering = true
      this.applyState()
    })
    this.on('pointerout', () => {
      this.hovering = false
      this.applyState()
    })
    this.on('pointerdown', () => this.press())
    this.on('pointerup', () => this.release(true))
    this.on('pointerupoutside', () => this.release(false))
  }

  private press(): void {
    if (this.disabled) return
    this.deps.animator.tween(this.inner.scale, {
      x: PRESS_SCALE,
      y: PRESS_SCALE,
      duration: tokens.duration.plaque.press,
      ease: 'power2.in',
      overwrite: true,
    })
    this.deps.platform.haptics.selection()
    if (this.deps.clickSound !== null) this.deps.platform.audio.play(this.deps.clickSound)
  }

  private release(activated: boolean): void {
    if (this.disabled) return
    this.deps.animator.tween(this.inner.scale, {
      x: 1,
      y: 1,
      duration: tokens.duration.plaque.release,
      ease: 'back.out(1.6)',
      overwrite: true,
    })
    if (activated) this.onActivate?.()
  }

  /** 三态只差一个透明度。禁用最暗、悬停最亮，平时在中间。 */
  private applyState(): void {
    if (this.disabled) this.inner.alpha = tokens.opacity.plaqueLine.paper.disabled
    else
      this.inner.alpha = this.hovering ? tokens.opacity.control.hover : tokens.opacity.control.idle
  }
}

/** 各变体不给 `ink` 时用哪个色。 */
function defaultInk(variant: SmallButtonVariant): string {
  // 圆章是深底浅字，另外两颗默认画在纸上。
  return variant === 'J' ? tokens.color.seal.mark : tokens.color.paper.inkMuted
}

/** 按钮 H：一枚左箭头加一行字，没有底。 */
function buildBack(
  parent: Container,
  deps: SmallButtonDeps,
  caption: string,
  ink: string,
): { width: number; height: number } {
  const arrow = new Graphics()
    .moveTo(ARROW.width, ARROW.height / 2)
    .lineTo(1, ARROW.height / 2)
    .moveTo(7, 1)
    .lineTo(1, ARROW.height / 2)
    .lineTo(7, ARROW.height - 1)
    .stroke({ width: ARROW.line, color: ink, cap: 'round', join: 'round' })
  const label = new Label(caption, TYPE.H, deps, ink)
  const height = Math.max(ARROW.height, label.textHeight)
  arrow.position.set(0, (height - ARROW.height) / 2)
  // 字靠左对齐（TYPE.H 的 align），所以原点就在字的左端，整颗钮的宽 = 箭头 + 空档 + 字。
  label.position.set(ARROW.width + ARROW_GAP, height / 2)
  parent.addChild(arrow, label)
  return { width: ARROW.width + ARROW_GAP + label.textWidth, height }
}

/** 按钮 J：一枚夜色圆章，中间一个「＋」或「－」。 */
function buildSeal(
  parent: Container,
  deps: SmallButtonDeps,
  glyph: SealGlyph,
  size: number,
  ink: string,
): { width: number; height: number } {
  // 圆章的盘底和外圈用的是全站共用的那两张白色纹理，靠 tint 上色（见 fx/uiTextures.ts）。
  const disc = new Sprite(deps.ui.sealDisc)
  disc.width = size
  disc.height = size
  disc.tint = tokens.color.seal.base
  disc.alpha = tokens.opacity.seal.base
  const ring = new Sprite(deps.ui.sealRing)
  ring.width = size
  ring.height = size
  ring.tint = ink

  const arm = size * SEAL.glyphRatio
  const mark = new Graphics().moveTo((size - arm) / 2, size / 2).lineTo((size + arm) / 2, size / 2)
  if (glyph === 'plus') mark.moveTo(size / 2, (size - arm) / 2).lineTo(size / 2, (size + arm) / 2)
  mark.stroke({ width: SEAL.glyphLine, color: ink, cap: 'round' })

  parent.addChild(disc, ring, mark)
  return { width: size, height: size }
}

/**
 * 按钮 L：一圈细框加一行字。
 *
 * 虚线那一档是**一段一段画出来的**：Pixi 的 Graphics 没有 dash 这回事，
 * 只能自己沿着四条边按「实线段 + 空档」步进。四个角的圆角这里省掉（虚线本来就断着，
 * 少那点圆角看不出来），换来的是一次性画完、之后一个字都不用重画。
 */
function buildWire(
  parent: Container,
  deps: SmallButtonDeps,
  caption: string,
  ink: string,
  dashed: boolean,
): { width: number; height: number } {
  const label = new Label(caption, TYPE.L, deps, ink)
  const width = Math.ceil(label.textWidth) + WIRE.padX * 2
  const height = WIRE.height
  const frame = new Graphics()
  if (dashed) strokeDashedRect(frame, width, height)
  else frame.roundRect(0.5, 0.5, width - 1, height - 1, tokens.radius.xs)
  frame.stroke({ width: 1, color: dashed ? tokens.color.paper.line : ink })
  label.position.set(width / 2, height / 2)
  parent.addChild(frame, label)
  return { width, height }
}

/** 沿着矩形四条边按「实线段 + 空档」步进，画出一圈虚线。 */
function strokeDashedRect(graphics: Graphics, width: number, height: number): void {
  const step = WIRE.dash + WIRE.gap
  const dash = (from: [number, number], to: [number, number]) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const ux = (to[0] - from[0]) / length
    const uy = (to[1] - from[1]) / length
    for (let at = 0; at < length; at += step) {
      const end = Math.min(at + WIRE.dash, length)
      graphics
        .moveTo(from[0] + ux * at, from[1] + uy * at)
        .lineTo(from[0] + ux * end, from[1] + uy * end)
    }
  }
  const [l, t, r, b] = [0.5, 0.5, width - 0.5, height - 0.5]
  dash([l, t], [r, t])
  dash([r, t], [r, b])
  dash([r, b], [l, b])
  dash([l, b], [l, t])
}
