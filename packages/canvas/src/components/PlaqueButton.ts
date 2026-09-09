/**
 * 匾额按钮：需求单里的按钮 A（墨蓝）、B（纸白）、C（陶橙）、K（纸面无底图标钮）。
 *
 * A~C 是**同一颗按钮**换三组颜色，不是三个组件——去重记录第 1 条已经把这件事写死了，
 * `color.plaque.<变体>.<状态>.<部位>` 那批令牌也是按这个结构存的。所以这里只有一个类，
 * 变体只挑令牌，不挑代码路径。K 是"不画底板"的那一档：纸上贴一枚深色圆章会重得像块补丁，
 * 所以它只有一枚实心墨色剪影加两档透明度。
 *
 * 匾额的形状是五张全白的预烤纹理叠出来的（见 fx/plaqueShapes.ts），
 * 上色全靠 tint 和 alpha：十二套配色一张纹理都不用多烤，换状态也不重建任何对象（3.10）。
 * 按下那一下只写 transform（下沉 + 纵向压扁），也在 3.10 允许的范围里。
 *
 * 缓动没有用旧样式那两条 cubic-bezier：GSAP 核心不认 CSS 的 cubic-bezier 字符串，
 * 要另外注册 CustomEase。这里先用内置的 back.out / power2.in 顶上，
 * 观感是一样的「弹回来」和「一下吃住」，理由记在需求单的令牌缺口表里。
 */

import { tokens } from '@ai-duel/design'
import type { Platform, SoundSpec } from '@ai-duel/platform'
import { Container, Rectangle, Sprite, type Texture } from 'pixi.js'
import { PLAQUE_BASE } from '../fx/plaqueShapes'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 编号变体。语义名见下面的别名常量，界面代码只在这几个里挑（7.1 第 2 条）。 */
export type PlaqueVariant = 'A' | 'B' | 'C' | 'K'

export const PLAQUE_NAVY: PlaqueVariant = 'A'
export const PLAQUE_PAPER: PlaqueVariant = 'B'
export const PLAQUE_TERRACOTTA: PlaqueVariant = 'C'
export const PLAQUE_PLAIN: PlaqueVariant = 'K'

export type PlaqueButtonState = 'default' | 'hover' | 'pressed' | 'disabled'

/**
 * 四个尺寸档各自匾上那行字的字号和字距（px）。
 *
 * 这一批**不进设计令牌**：它们是旧样式里就地写的中号字（24 / 20 / 18 / 19px），
 * 四个数互不相同也不成阶梯，只服务这一个组件，收进令牌就是给一个没人复用的数起个全局名字
 *（design 的 README「明确不收什么」里「组件私有字号」那条说的就是它们）。
 * 集中成一张表而不是分散写进下面四个尺寸对象里，是为了「不进令牌」这件事有一处交代得清——
 * 散开写的话，下一个人只会看到四处零散的魔法数字，看不出它们是同一类东西。
 *
 * 字距是把旧样式的 em 值乘开的结果：0.25em × 24px = 6，0.22em × 18px = 3.96，以此类推。
 */
const PLAQUE_TYPE = {
  default: { fontSize: 24, letterSpacing: 6 },
  endTurn: { fontSize: 20, letterSpacing: 4 },
  play: { fontSize: 18, letterSpacing: 3.96 },
  urge: { fontSize: 19, letterSpacing: 4.56 },
} as const

/** 四个尺寸档。宽高和左右内边距从令牌取，字号和字距取上面那张表。 */
export const PLAQUE_SIZES = {
  /** 全站主操作键的默认档。 */
  default: {
    width: tokens.size.plaque.width,
    height: tokens.size.plaque.height,
    padX: tokens.size.plaque.padX,
    ...PLAQUE_TYPE.default,
  },
  /** 对局右下角的「结束出牌 / 等待对方… / 答题中…」。 */
  endTurn: {
    width: tokens.size.plaque.endTurnWidth,
    height: tokens.size.plaque.endTurnHeight,
    padX: tokens.size.plaque.padXSmall,
    ...PLAQUE_TYPE.endTurn,
  },
  /** 手牌上方那颗「打出」，触屏才有。 */
  play: {
    width: tokens.size.plaque.playWidth,
    height: tokens.size.plaque.playHeight,
    padX: tokens.size.plaque.padXSmall,
    ...PLAQUE_TYPE.play,
  },
  /** 等对方出牌时的「催一催」。 */
  urge: {
    width: tokens.size.plaque.urgeWidth,
    height: tokens.size.plaque.urgeHeight,
    padX: tokens.size.plaque.padXSmall,
    ...PLAQUE_TYPE.urge,
  },
} as const

export type PlaqueSizeName = keyof typeof PLAQUE_SIZES

/** 一个变体的全部配色。K 没有底板，所以它不在这张表里。 */
const PALETTES = {
  A: {
    states: tokens.color.plaque.navy,
    trim: tokens.color.plaque.navy,
    lineAlpha: tokens.opacity.plaqueLine.navy,
    cornerAlpha: tokens.opacity.plaqueCorner.navy,
  },
  B: {
    states: tokens.color.plaque.paper,
    trim: tokens.color.plaque.paper,
    lineAlpha: tokens.opacity.plaqueLine.paper,
    cornerAlpha: tokens.opacity.plaqueCorner.paper,
  },
  C: {
    states: tokens.color.plaque.terracotta,
    trim: tokens.color.plaque.terracotta,
    lineAlpha: tokens.opacity.plaqueLine.terracotta,
    cornerAlpha: tokens.opacity.plaqueCorner.terracotta,
  },
} as const

/** 按下和悬停是两回事：按下只改姿态，颜色仍用默认那一档（旧样式的 :active 也是这样）。 */
const COLOR_STATE = {
  default: 'default',
  hover: 'hover',
  pressed: 'default',
  disabled: 'disabled',
} as const

/** 按下时整块下沉的距离和纵向压扁的比例，抄旧样式的 `translateY(6px) scaleY(0.96)`。 */
const PRESS_SINK = 6
const PRESS_SQUASH = 0.96

export interface PlaqueButtonDeps {
  ui: UiTextures
  text: TextTextureCache
  /** 补间的唯一入口。按下和弹回都从这儿建，帧循环才推得动、也才停得下来（3.6）。 */
  animator: Animator
  /**
   * 触感和音效走它。谁都不直接碰浏览器 API（第 2 节第 5 条）。
   *
   * 只收这两样能力，不收整个 `Platform`：按钮真正用到的就是它们两个，
   * 而对局场景往下透的也只有这两项（见 scenes/duel 的契约）。声明成整个的话，
   * 调用方为了一颗按钮要把网络、存储、全屏、安全区一起配齐。
   */
  platform: Pick<Platform, 'audio' | 'haptics'>
  /**
   * 按下时放的那一声。资源地址不归 canvas 管，由调用方给；给 null 就不出声。
   * 旧版是 document 级捕获 click 统一放（useGlobalButtonSound），改成按钮自己在按下时放：
   * 那样一来"哪些东西算按钮"由组件说了算，不再靠一条全局规则去猜。
   */
  clickSound: SoundSpec | null
}

export interface PlaqueButtonOptions {
  variant: PlaqueVariant
  /** A~C 用：匾上印的字。 */
  caption?: string
  /** K 用：那枚剪影。canvas 不管资源从哪来，纹理由调用方给。 */
  icon?: Texture
  /** A~C 用：挑一个尺寸档，默认 default。 */
  size?: PlaqueSizeName
  disabled?: boolean
  /** 松手且指针还在按钮上时叫一声。禁用时不会被调到。 */
  onActivate?: () => void
}

export class PlaqueButton extends Container {
  readonly variant: PlaqueVariant
  readonly boxWidth: number
  readonly boxHeight: number

  /** 会被按下动画整块挪的那一层。按钮自己的 position 留给调用方摆版式，两边互不覆盖。 */
  private readonly inner = new Container()
  private readonly layers: {
    sprite: Sprite
    role: 'surface' | 'edge' | 'rim' | 'corner' | 'spark'
  }[] = []
  private readonly caption: Label | null = null
  private readonly icon: Sprite | null = null
  private readonly deps: PlaqueButtonDeps
  private readonly onActivate: (() => void) | undefined

  private state: PlaqueButtonState
  private hovering = false
  /**
   * 压入那条补间。松手时读它的进度来算「还欠多久才满最短压入时长」，见 release。
   *
   * 读补间进度而不是问 `performance.now()`：目录页和 bench 跑的是手动时钟，
   * GSAP 跟着那个时钟走而真实时钟照旧在跑，两边混用算出来的差值是错的。
   */
  private pressTween: ReturnType<Animator['tween']> | null = null

  constructor(options: PlaqueButtonOptions, deps: PlaqueButtonDeps) {
    super()
    this.variant = options.variant
    this.deps = deps
    this.onActivate = options.onActivate
    this.state = options.disabled === true ? 'disabled' : 'default'

    const size = PLAQUE_SIZES[options.size ?? 'default']
    const plain = options.variant === 'K'
    this.boxWidth = plain ? tokens.size.control.iconBattle : size.width
    this.boxHeight = plain ? tokens.size.control.iconBattle : size.height

    /*
     * 压入以底边为支点（旧样式的 transform-origin: center bottom）。
     * 做法是把 pivot 放到底边、再把整层往下挪同样多，于是 scale.y 就是绕底边缩。
     */
    this.inner.pivot.set(0, this.boxHeight)
    this.inner.y = this.boxHeight
    this.addChild(this.inner)

    if (plain) this.icon = this.buildIcon(options.icon)
    else this.caption = this.buildPlaque(options.caption ?? '', size)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    /*
     * 命中区显式给成整块矩形，不让 Pixi 按子节点包围盒算：按下那一下会把内层压扁，
     * 包围盒跟着变，命中区一抖指针就可能"滑出"按钮，松手时点不着。
     */
    this.hitArea = new Rectangle(0, 0, this.boxWidth, this.boxHeight)
    this.bindPointer()
    this.applyState()
  }

  /** 现在是哪一态。目录页和测试拿它对账。 */
  get currentState(): PlaqueButtonState {
    return this.state
  }

  /** 点不点得动。禁用时连悬停都不响应。 */
  setDisabled(disabled: boolean): void {
    if (disabled === (this.state === 'disabled')) return
    this.state = disabled ? 'disabled' : this.hovering ? 'hover' : 'default'
    this.cursor = disabled ? 'default' : 'pointer'
    this.applyState()
  }

  /** 把某一态直接摆出来（目录页要拍「悬停」「按下」这两张，没有真指针可用）。 */
  showState(state: PlaqueButtonState): void {
    this.state = state
    this.hovering = state === 'hover'
    this.applyState()
    this.inner.y = this.boxHeight + (state === 'pressed' ? PRESS_SINK : 0)
    this.inner.scale.y = state === 'pressed' ? PRESS_SQUASH : 1
  }

  private buildPlaque(text: string, size: (typeof PLAQUE_SIZES)[PlaqueSizeName]): Label {
    const scaleX = this.boxWidth / PLAQUE_BASE.width
    const scaleY = this.boxHeight / PLAQUE_BASE.height
    const roles = ['surface', 'edge', 'rim', 'corner', 'spark'] as const
    const textures = {
      surface: this.deps.ui.plaqueSurface,
      edge: this.deps.ui.plaqueEdge,
      rim: this.deps.ui.plaqueRim,
      corner: this.deps.ui.plaqueCorner,
      spark: this.deps.ui.plaqueSpark,
    }
    for (const role of roles) {
      const sprite = new Sprite(textures[role])
      // 非等比拉伸，和旧版 SVG 的 preserveAspectRatio="none" 是同一个效果（描边跟着变粗细）。
      sprite.scale.set(scaleX, scaleY)
      this.inner.addChild(sprite)
      this.layers.push({ sprite, role })
    }
    const caption = new Label(
      text,
      {
        fontSize: size.fontSize,
        weight: '600',
        letterSpacing: size.letterSpacing,
        maxWidth: this.boxWidth - size.padX * 2,
      },
      this.deps,
    )
    caption.position.set(this.boxWidth / 2, this.boxHeight / 2)
    this.inner.addChild(caption)
    return caption
  }

  private buildIcon(texture: Texture | undefined): Sprite {
    if (texture === undefined) throw new Error('按钮 K 是图标钮，必须给一张 icon 纹理')
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    sprite.position.set(this.boxWidth / 2, this.boxHeight / 2)
    // 图标按短边铺满整个命中区：旧版这几颗的图形本来就是撑满盒子的实心剪影。
    const fit = Math.min(this.boxWidth / texture.width, this.boxHeight / texture.height)
    sprite.scale.set(fit)
    sprite.tint = tokens.color.battle.ink
    this.inner.addChild(sprite)
    return sprite
  }

  private bindPointer(): void {
    this.on('pointerover', () => {
      this.hovering = true
      if (this.state === 'disabled') return
      this.state = 'hover'
      this.applyState()
    })
    this.on('pointerout', () => {
      this.hovering = false
      if (this.state === 'disabled') return
      if (this.state === 'pressed') this.release(false)
      else {
        this.state = 'default'
        this.applyState()
      }
    })
    this.on('pointerdown', () => this.press())
    this.on('pointerup', () => this.release(true))
    this.on('pointerupoutside', () => this.release(false))
  }

  private press(): void {
    if (this.state === 'disabled' || this.state === 'pressed') return
    this.state = 'pressed'
    this.applyState()
    this.pressTween = this.deps.animator.tween(this.inner, {
      y: this.boxHeight + PRESS_SINK,
      duration: tokens.duration.plaque.press,
      ease: 'power2.in',
      overwrite: true,
    })
    this.deps.animator.tween(this.inner.scale, {
      y: PRESS_SQUASH,
      duration: tokens.duration.plaque.press,
      ease: 'power2.in',
      overwrite: true,
    })
    this.deps.platform.haptics.selection()
    if (this.deps.clickSound !== null) this.deps.platform.audio.play(this.deps.clickSound)
  }

  /**
   * 松手。
   *
   * `activated` 为真表示松手时指针还压在按钮上，那才算点了一下。
   * 弹回来那一下要等压入姿态撑满最短时长（旧版 PlaqueButton 的 MIN_PRESS_MS，
   * 和 `duration.plaque.press` 恰好是同一个数）：点得再快也得看得见按下去过，
   * 不然反馈的强弱取决于用户按键的手速。欠多久按压入补间的剩余进度算。
   */
  private release(activated: boolean): void {
    if (this.state !== 'pressed') return
    this.state = this.hovering ? 'hover' : 'default'
    this.applyState()
    const pressed = this.pressTween?.progress() ?? 1
    this.pressTween = null
    const vars = {
      duration: tokens.duration.plaque.release,
      ease: 'back.out(1.6)',
      delay: (1 - pressed) * tokens.duration.plaque.press,
      overwrite: true,
    }
    this.deps.animator.tween(this.inner, { y: this.boxHeight, ...vars })
    this.deps.animator.tween(this.inner.scale, { y: 1, ...vars })
    if (activated) this.onActivate?.()
  }

  /** 把当前状态的颜色写到各层上。全是 tint 和 alpha，一个对象都不重建。 */
  private applyState(): void {
    if (this.variant === 'K') {
      if (this.icon !== null) {
        this.icon.alpha =
          this.state === 'default' ? tokens.opacity.control.idle : tokens.opacity.control.hover
      }
      return
    }
    const palette = PALETTES[this.variant]
    const colorState = COLOR_STATE[this.state]
    /*
     * 四个变体的三档配色现在都齐了（米白那档的禁用色见 color.plaque.ivory.disabled）。
     * 但米白（按钮 D）还没接进这个类：它只出现在英雄页，那一页还没做，
     * 接上之前不先加一条没人走的代码路径。
     */
    const colors = palette.states[colorState]
    for (const { sprite, role } of this.layers) {
      switch (role) {
        case 'surface':
          sprite.tint = colors.fill
          break
        case 'edge':
          sprite.tint = colors.edge
          break
        case 'rim':
          sprite.tint = colors.line
          sprite.alpha = palette.lineAlpha[colorState]
          break
        case 'corner':
          sprite.tint = palette.trim.corner
          sprite.alpha = palette.cornerAlpha
          break
        case 'spark':
          sprite.tint = palette.trim.spark
          sprite.alpha = tokens.opacity.plaqueSpark
          break
      }
    }
    this.caption?.setColor(colors.text)
  }
}
