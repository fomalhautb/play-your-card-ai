/**
 * 对局顶栏：一条横贯整幅的素方块，正中一格报「第几轮 + 比分」，右端「静音」和「离开」两格。
 *
 * 正式版简化第 4 步之二把这一条剥成素方块（见 components/Box.ts）：从前的纸带底、
 * 拆成九段的轮次比分、中间那颗装饰菱形、两颗图标钮全删了，静音那颗当时也一起删了
 *（理由是设置页有同一个开关）。**现在又补回来一格**：全站那颗静音钮钉在视口右上角
 *（client 的 app/MuteButton.tsx），只有对局页不渲染它——那个位置正压着「离开」。
 * 而对局页要开关声音，此外就只剩设置页那条路，那得先退出整局才点得到。
 *
 * 这一格**只在场景传了 `onToggleMute` 时才建**：目录页和 bench 不传，它们的截图基线
 * 因此一张都不变（同 `actions: 'none'` 那一档的思路）。
 *
 * 组件仍然是哑的：它不认识引擎，也不知道现在是第几轮——`setRound` / `setScore` /
 * `setStatus` 由场景在收到 cue 时调。宽高由场景给（`resize`），因为桌面和手机是两档
 * 并列的版式（见 scenes/duel/layout/types.ts），顶栏在两档下高度不同。
 *
 * 正中那一格换内容是**换整张文字纹理**（`Box.setLabel`），所以只在比分或轮次真的变了时
 * 才调——一轮里只发生几次，都不在动画期间。
 */

import { Container, Graphics } from 'pixi.js'
import { Box, type BoxDeps, CANVAS_BACKGROUND } from './Box'

/** 正中那一格占顶栏多宽，以及「离开」那一颗的尺寸和它离右缘多远（「静音」照它一样大）。 */
const CENTER_RATIO = 0.5
const LEAVE = { width: 88, height: 36, inset: 16 } as const
/** 顶栏上下各留多少，正中那一格才不至于顶满整条。 */
const PAD_Y = 8
/**
 * 「静音」和「离开」之间空多少。
 *
 * 两格挨着一样大，中间不留缝的话看着像一整块，手机上还容易点错隔壁那一格。
 */
const ACTION_GAP = 12
/**
 * 「静音」那一格印什么字。印的是**按下去会发生什么**，不是当前状态：
 * 现在有声就写「静音」，已经静了就写「取消静音」。
 */
const MUTE_TEXT = { off: '静音', on: '取消静音' } as const

export type TopBarDeps = BoxDeps

export interface TopBarOptions {
  width: number
  height: number
  /**
   * 右端摆不摆「离开」。默认摆。
   *
   * 留这一档是给目录页和开发页用的：那两处只想看顶栏长什么样，不需要一颗点了会退出的钮。
   * 两档版式都摆——「离开对局」在手机上**没有别的入口**，第 21 条那会儿割掉过一次，
   * 结果是手机上根本退不出对局。
   */
  actions?: 'leave' | 'none'
  onLeave?: () => void
  /**
   * 「离开」左边那一格「静音」按下时叫谁。
   *
   * **不给就整格不建**，不是「点了没反应」——这是和 `onLeave` 有意不一样的地方。
   * 目录页 story 和 bench 的关键帧都不传它，顶栏因此和从前一模一样，那两套截图基线
   *（其中 linux 那份现在补不了）一张都不用重拍。
   */
  onToggleMute?: () => void
}

export class TopBar extends Container {
  boxHeight: number

  /**
   * 垫在整条顶栏底下那块不透明的底。
   *
   * 素方块本身是空心的（见 components/Box.ts），而这一条**必须挡光**：对手那排手牌钉在
   * 舞台顶边、上半截本来就该被顶栏遮住（黑客松版就是这么摆的，见版式里 foeHand 的 y=0）。
   * 不垫的话那几张牌背会从顶栏里透出来，压在轮次比分上。
   */
  private readonly backdrop = new Graphics()
  private readonly plate: Box
  private readonly center: Box
  private readonly leave: Box | null
  private readonly mute: Box | null
  private boxWidth: number

  private round = 1
  private score: { mine: number; theirs: number } | null = null
  private status: string | null = null
  private muted = false

  constructor(options: TopBarOptions, deps: TopBarDeps) {
    super()
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.label = 'top-bar'

    this.plate = new Box({ width: options.width, height: options.height }, deps)
    this.center = new Box({ width: 1, height: 1, label: this.centerText() }, deps)
    this.leave =
      (options.actions ?? 'leave') === 'none'
        ? null
        : new Box({ width: LEAVE.width, height: LEAVE.height, label: '离开' }, deps)
    if (this.leave !== null) {
      // 在场景树上给它留个名字：真浏览器的交互回归靠它找到「按哪儿」（bench 的 hitPoints.ts）。
      this.leave.label = 'button:leave'
      if (options.onLeave !== undefined) this.leave.onPress(options.onLeave)
    }
    if (options.onToggleMute === undefined) {
      this.mute = null
    } else {
      // 尺寸沿用「离开」那一档：两格并排，一大一小只会显得是排版没对齐。
      this.mute = new Box({ width: LEAVE.width, height: LEAVE.height, label: MUTE_TEXT.off }, deps)
      this.mute.label = 'button:mute'
      this.mute.onPress(options.onToggleMute)
    }
    this.addChild(this.backdrop, this.plate, this.center)
    if (this.mute !== null) this.addChild(this.mute)
    if (this.leave !== null) this.addChild(this.leave)
    this.layout()
  }

  /** 改大小。只在版式变了（转屏、改窗口大小）时调，不在动画期间。 */
  resize(width: number, height?: number): void {
    this.boxWidth = width
    this.boxHeight = height ?? this.boxHeight
    this.plate.setSize(this.boxWidth, this.boxHeight)
    this.layout()
  }

  /** 第几轮。 */
  setRound(round: number): void {
    if (this.round === round) return
    this.round = round
    this.center.setLabel(this.centerText())
  }

  /**
   * 「静音」那一格跟着真身走。
   *
   * 状态的真身在 `platform.audio` 上（client 的 audio/mute.ts 落盘），顶栏自己不记：
   * 设置页、全站那颗钮都能改它，这一格照着订阅来的值换字就行。
   * 没建这一格（目录页、bench）时调它什么都不做。
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return
    this.muted = muted
    this.mute?.setLabel(muted ? MUTE_TEXT.on : MUTE_TEXT.off)
  }

  /** 比分。传 null 表示局面还没到手（联机客人在等房主开局），正中那格就只剩轮次。 */
  setScore(score: { mine: number; theirs: number } | null): void {
    if (this.score?.mine === score?.mine && this.score?.theirs === score?.theirs) return
    this.score = score === null ? null : { ...score }
    this.center.setLabel(this.centerText())
  }

  /**
   * 顶掉正中那格，改成一行状态字（「网络不稳，正在重连…」这类）。传 null 恢复比分。
   *
   * 旧版这句话挂在战场中线的回合徽章上，顶栏只有比分。搬到顶栏是因为中线那块归 BoardGrid，
   * 而链路断了要盖住的正是「第几轮、几比几」这种此刻不重要的信息。
   */
  setStatus(text: string | null): void {
    if (this.status === text) return
    this.status = text
    this.center.setLabel(this.centerText())
  }

  /**
   * 正中那一格印什么。
   *
   * 九段拼成一行：素方块只印一行字，而这一行说的本来就是一件事（「这一局打到哪儿了」），
   * 拆成九张纹理只是从前为了让轮次号和比分各有各的字号。
   */
  private centerText(): string {
    if (this.status !== null) return this.status
    if (this.score === null) return `第 ${this.round} 轮`
    return `第 ${this.round} 轮 · 我方 ${this.score.mine} : ${this.score.theirs} 对方`
  }

  /** 正中那格居中、让开右端那两颗钮；「离开」贴右缘、「静音」紧挨着它左边，都纵向居中。 */
  private layout(): void {
    this.backdrop
      .clear()
      .rect(0, 0, this.boxWidth, this.boxHeight)
      .fill({ color: CANVAS_BACKGROUND })
    const centerWidth = Math.max(1, this.boxWidth * CENTER_RATIO)
    const centerHeight = Math.max(1, this.boxHeight - PAD_Y * 2)
    this.center.setSize(centerWidth, centerHeight)
    this.center.position.set((this.boxWidth - centerWidth) / 2, PAD_Y)
    const actionY = (this.boxHeight - LEAVE.height) / 2
    const leaveX = this.boxWidth - LEAVE.inset - LEAVE.width
    this.leave?.position.set(leaveX, actionY)
    /*
     * 「静音」按「离开」的左边算，而不是自己从右缘量。
     *
     * `actions: 'none'` 那一档没有「离开」，但那一档也不会传 `onToggleMute`
     *（目录页和 bench 两样都不传），所以这里不必为「只有静音没有离开」再分一路。
     */
    this.mute?.position.set(leaveX - ACTION_GAP - LEAVE.width, actionY)
  }
}
