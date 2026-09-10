/**
 * 对局顶栏：一条横贯整幅的纸带，正中报「第几轮 + 比分」，右端两颗图标钮（离开、静音）。
 * 需求单的面板 C + 按钮 K×2 + 图标 C（中间那颗小菱形）。
 *
 * 组件是哑的：它不认识引擎，也不知道现在是第几轮——`setRound` / `setScore` / `setStatus`
 * 由场景在收到 cue 时调。宽高也由场景给（`resize`），因为桌面和手机是两档并列的版式
 *（见 scenes/duelLayout.ts 的文件头），顶栏在两档下高度不同。
 *
 * 换文字一律是**换 Label 对象**，不是改文字内容：Label 建好之后就没有能改内容的东西了
 *（见 Label.ts 的文件头），比分从 0 跳到 1 就得换一张纹理。所以这里把「正中那一块」
 * 整块重建，而不是逐个字段去改——重建的是三五个显示对象，比逐个字段判断哪个变了简单得多，
 * 而且一轮里只发生几次，不在动画期间（3.10 管的是稳态每帧，不是状态切换那一下）。
 *
 * 比分数字**不跟着触屏档放大**：旧样式里只放大「第 … 轮」「我方 / 对方」这两组标签
 *（`.battle-topbar__round` / `__score` 的 `--fs-mid-scale`），数字维持原样——
 * 它们本来就够大，跟着放会顶破顶栏定死的高度。
 */

import { tokens } from '@ai-duel/design'
import type { Platform, SoundSpec } from '@ai-duel/platform'
import { Container, Graphics, type Texture } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'
import { PANEL_TOPBAR, Panel } from './Panel'
import { PLAQUE_PLAIN, PlaqueButton } from './PlaqueButton'

/**
 * 顶栏正中那几段字的字号和字距（px），以及块与块之间的间隔。
 *
 * 按 design 的 README「组件私有字号和字距」那条留在组件里：这几个数只服务顶栏，
 * 互不相同也不成阶梯。字距是把旧样式的 em 值乘开的（0.18em × 18px ≈ 3.24）。
 * 来源：legacy-client/src/styles.css 的 `.battle-topbar__*` 一族。
 */
const TYPE = {
  /** 「第 … 轮」那两个标签字。 */
  round: { fontSize: 18, letterSpacing: 3.24 },
  /** 轮次号，比标签大一档。 */
  roundNum: { fontSize: 24, letterSpacing: 0 },
  /** 「我方 / 对方」两个标签字。 */
  scoreSide: { fontSize: 17, letterSpacing: 2.72 },
  /** 比分数字，整条顶栏上最大的一档。 */
  scoreNum: { fontSize: 30, letterSpacing: 0 },
  /** 比分中间那个冒号。 */
  colon: { fontSize: 22, letterSpacing: 0 },
  /** 没有局面时那行状态字（「等房主开局」「网络不稳，正在重连…」）。 */
  status: { fontSize: 18, letterSpacing: 3.24 },
} as const

/** 正中那一块里，相邻两段之间留多宽。抄旧样式 `.battle-topbar__status` 的 `gap: 28px`。 */
const GROUP_GAP = 28
/** 比分那一块内部，数字和标签之间留多宽。抄 `.battle-topbar__score-num` 的 `margin: 0 7px`。 */
const SCORE_GAP = 7
/** 「第 N 轮」那三段之间留多宽。旧版靠字距自然撑开，这里三段各是一张纹理，得自己补。 */
const WORD_GAP = 4
/** 中间那颗装饰菱形的边长。抄 `.battle-topbar__diamond` 的 11px。 */
const DIAMOND_SIZE = 11
/** 右端那两颗图标钮之间的间隔，以及整簇离右缘多远。抄 `.battle-actions` 的 gap 14 / right 26。 */
const ACTION_GAP = 14
const ACTION_INSET = 26

export interface TopBarDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
  platform: Pick<Platform, 'audio' | 'haptics'>
  /** 按下时放的那一声，直接透给两颗图标钮。给 null 就不出声（见 PlaqueButton 的同名项）。 */
  clickSound: SoundSpec | null
  /** 两颗图标钮的剪影。canvas 不管资源从哪来，纹理由调用方给（同 PlaqueButton 的 icon）。 */
  icons: { leave: Texture; mute: Texture }
}

export interface TopBarOptions {
  width: number
  /** 不给就取桌面档令牌。触屏档由场景传 `size.battle.topbarHeightTouch`。 */
  height?: number
  /**
   * 右端那两颗图标钮（静音、离开）摆不摆。默认摆。
   *
   * 触屏档传 false：一条 390 宽的顶栏放不下「第 N 轮 + 比分」再加两颗 51 见方的钮，
   * 正中那块会被压到钮底下。手机上这两件事归设置面板（第 31 条），不占对局顶栏。
   */
  actions?: boolean
  onLeave?: () => void
  onToggleMute?: () => void
}

export class TopBar extends Container {
  readonly boxHeight: number

  private readonly deps: TopBarDeps
  /** 正中那一块。换内容时整块重建，理由见文件头。 */
  private readonly center = new Container()
  private readonly actions = new Container()
  /** 底板。改尺寸时整块换新的（它的几何是建的时候画死的），所以这一项不是 readonly。 */
  private plate: Panel
  private boxWidth: number

  private round = 1
  private score: { mine: number; theirs: number } | null = null
  private status: string | null = null

  constructor(options: TopBarOptions, deps: TopBarDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height ?? tokens.size.battle.topbarHeight
    this.label = 'top-bar'

    this.plate = new Panel(
      { variant: PANEL_TOPBAR, width: this.boxWidth, height: this.boxHeight },
      deps,
    )
    this.addChild(this.plate, this.center, this.actions)
    if (options.actions !== false) this.buildActions(options)
    this.rebuildCenter()
  }

  /**
   * 改大小。底板要按新尺寸重画，所以整块换一个新的 Panel——它的几何是建的时候画死的。
   * 只在版式变了（转屏、改窗口大小）时调，不在动画期间。
   */
  resize(width: number, height?: number): void {
    this.boxWidth = width
    const index = this.getChildIndex(this.plate)
    this.removeChild(this.plate)
    this.plate.destroy({ children: true })
    this.plate = new Panel(
      { variant: PANEL_TOPBAR, width, height: height ?? this.boxHeight },
      this.deps,
    )
    // 底板得留在最底下，所以插回原来那一位而不是追加到末尾。
    this.addChildAt(this.plate, index)
    this.layoutActions()
    this.layoutCenter()
  }

  /** 第几轮。 */
  setRound(round: number): void {
    if (this.round === round) return
    this.round = round
    this.rebuildCenter()
  }

  /** 比分。传 null 表示局面还没到手（联机客人在等房主开局），正中那块就空着。 */
  setScore(score: { mine: number; theirs: number } | null): void {
    if (this.score?.mine === score?.mine && this.score?.theirs === score?.theirs) return
    this.score = score === null ? null : { ...score }
    this.rebuildCenter()
  }

  /**
   * 顶掉正中那块，改成一行状态字（「网络不稳，正在重连…」这类）。传 null 恢复比分。
   *
   * 旧版这句话挂在战场中线的回合徽章上，顶栏只有比分。搬到顶栏是因为中线那块归 BoardGrid，
   * 而链路断了要盖住的正是「第几轮、几比几」这种此刻不重要的信息——
   * 玩家该看的是「现在连不上」，不是比分。
   */
  setStatus(text: string | null): void {
    if (this.status === text) return
    this.status = text
    this.rebuildCenter()
  }

  private buildActions(options: TopBarOptions): void {
    const make = (icon: Texture, onActivate: (() => void) | undefined): PlaqueButton =>
      new PlaqueButton({ variant: PLAQUE_PLAIN, icon, onActivate }, this.deps)
    this.actions.addChild(make(this.deps.icons.mute, options.onToggleMute))
    this.actions.addChild(make(this.deps.icons.leave, options.onLeave))
    this.layoutActions()
  }

  /** 两颗钮从右往左排，整簇纵向居中。 */
  private layoutActions(): void {
    let right = this.boxWidth - ACTION_INSET
    for (let i = this.actions.children.length - 1; i >= 0; i -= 1) {
      const button = this.actions.children[i] as PlaqueButton
      right -= button.boxWidth
      button.position.set(right, (this.boxHeight - button.boxHeight) / 2)
      right -= ACTION_GAP
    }
  }

  /** 把正中那块整个重建。建完立刻摆位。 */
  private rebuildCenter(): void {
    for (const child of this.center.removeChildren()) child.destroy({ children: true })
    if (this.status !== null) this.addPiece(new Label(this.status, TYPE.status, this.deps))
    else if (this.score !== null) this.buildStatusRow(this.score)
    this.layoutCenter()
  }

  /** 「第 N 轮 ◆ 我方 x : y 对方」。 */
  private buildStatusRow(score: { mine: number; theirs: number }): void {
    const muted = tokens.color.battle.inkMuted
    /*
     * 「第 N 轮」拆成三段是因为中间那个数字大一档、颜色也不一样（旧版同样拆成三个 span）。
     * 拆开之后段与段之间要自己补空隙——一段文字纹理是贴着字形烤的，两段挨在一起就顶死了。
     */
    this.addPiece(new Label('第', TYPE.round, this.deps, muted))
    this.addPiece(
      new Label(String(this.round), TYPE.roundNum, this.deps, tokens.color.battle.ink),
      WORD_GAP,
    )
    this.addPiece(new Label('轮', TYPE.round, this.deps, muted), WORD_GAP)
    this.addPiece(this.diamond(), GROUP_GAP)
    this.addPiece(new Label('我方', TYPE.scoreSide, this.deps, muted), GROUP_GAP)
    this.addPiece(this.scoreNum(score.mine), SCORE_GAP)
    this.addPiece(new Label(':', TYPE.colon, this.deps, muted), SCORE_GAP)
    this.addPiece(this.scoreNum(score.theirs), SCORE_GAP)
    this.addPiece(new Label('对方', TYPE.scoreSide, this.deps, muted), SCORE_GAP)
  }

  private scoreNum(value: number): Label {
    return new Label(String(value), TYPE.scoreNum, this.deps, tokens.color.battle.navy)
  }

  /** 轮次和比分中间那颗装饰菱形：一个方块转 45°。同 Divider 里那颗宝石的画法。 */
  private diamond(): Container {
    const box = new Container()
    const size = DIAMOND_SIZE / Math.SQRT2
    const gem = new Graphics()
      .rect(-size / 2, -size / 2, size, size)
      .fill({ color: tokens.color.battle.lineDark })
    gem.rotation = Math.PI / 4
    gem.alpha = 0.72
    box.addChild(gem)
    return box
  }

  /**
   * 往正中那块追加一段，并记下它前面要留多宽的空隙。
   *
   * 空隙记在显示对象的 `label` 上而不是另开一个数组：这一块整个是临时的，
   * 重建时连同间隔一起丢掉，多存一份就多一处要同步清空的状态。
   */
  private addPiece(piece: Container, gapBefore = 0): void {
    piece.label = String(gapBefore)
    this.center.addChild(piece)
  }

  /**
   * 把正中那块从左到右排开，整块在顶栏里居中。
   *
   * 各段的原点在自己的纵向中心（Label 的锚点是 0.5），所以纵向统一摆在顶栏正中，
   * 不按基线对齐——旧版用 grid 的 `align-items: baseline` 是因为 DOM 里文字盒子有上下留白，
   * 而这里每段都是一张贴着字形烤出来的纹理，按中心对齐看着就是齐的。
   */
  private layoutCenter(): void {
    const widths = this.center.children.map((child) => {
      const gap = Number(child.label)
      return { child, gap, width: child instanceof Label ? child.textWidth : child.width }
    })
    const total = widths.reduce((sum, item) => sum + item.gap + item.width, 0)
    let x = (this.boxWidth - total) / 2
    const centerY = this.boxHeight / 2
    for (const item of widths) {
      x += item.gap
      // Label 的原点在自己的横向中心（align 默认 center），别的（菱形）原点也在中心。
      item.child.position.set(x + item.width / 2, centerY)
      x += item.width
    }
  }
}
