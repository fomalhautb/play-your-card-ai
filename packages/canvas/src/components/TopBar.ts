/**
 * 对局顶栏：一条横贯整幅的素方块，正中一格报「第几轮 + 比分」，右端一颗「离开」。
 *
 * 正式版简化第 4 步之二把这一条剥成素方块（见 components/Box.ts）：从前的纸带底、
 * 拆成九段的轮次比分、中间那颗装饰菱形、两颗图标钮全删了。**静音钮这一步一起删掉**——
 * 设置页里有同一个开关（第 31 条做的），顶栏留一颗只是占地方。
 *
 * 组件仍然是哑的：它不认识引擎，也不知道现在是第几轮——`setRound` / `setScore` /
 * `setStatus` 由场景在收到 cue 时调。宽高由场景给（`resize`），因为桌面和手机是两档
 * 并列的版式（见 scenes/duel/layout/types.ts），顶栏在两档下高度不同。
 *
 * 正中那一格换内容是**换整张文字纹理**（`Box.setLabel`），所以只在比分或轮次真的变了时
 * 才调——一轮里只发生几次，都不在动画期间。
 */

import { Container } from 'pixi.js'
import { Box, type BoxDeps } from './Box'

/** 正中那一格占顶栏多宽，以及「离开」那一颗的尺寸和它离右缘多远。 */
const CENTER_RATIO = 0.5
const LEAVE = { width: 88, height: 36, inset: 16 } as const
/** 顶栏上下各留多少，正中那一格才不至于顶满整条。 */
const PAD_Y = 8

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
}

export class TopBar extends Container {
  boxHeight: number

  private readonly plate: Box
  private readonly center: Box
  private readonly leave: Box | null
  private boxWidth: number

  private round = 1
  private score: { mine: number; theirs: number } | null = null
  private status: string | null = null

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
    this.addChild(this.plate, this.center)
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

  /** 正中那格居中、让开右端那颗钮；「离开」贴右缘、纵向居中。 */
  private layout(): void {
    const centerWidth = Math.max(1, this.boxWidth * CENTER_RATIO)
    const centerHeight = Math.max(1, this.boxHeight - PAD_Y * 2)
    this.center.setSize(centerWidth, centerHeight)
    this.center.position.set((this.boxWidth - centerWidth) / 2, PAD_Y)
    this.leave?.position.set(
      this.boxWidth - LEAVE.inset - LEAVE.width,
      (this.boxHeight - LEAVE.height) / 2,
    )
  }
}
