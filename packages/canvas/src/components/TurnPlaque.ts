/**
 * 「对方回合」吊匾：等对方出牌的那一段，从顶栏下沿吊下来的一块方块。
 *
 * 黑客松版有这一块（`.battle__turn-plaque`），正式版一直缺（`Panel` 里那个变体建好了没人摆）。
 * 正式版简化第 4 步之二把它补回来，同时剥成素方块（见 components/Box.ts）：
 * 两根挂绳、双线框、墨蓝底都不画了，只剩一圈描边加一行字。
 *
 * ## 那三个点为什么不跳
 *
 * 黑客松版那三个点是 CSS 的 `infinite` 动画，浏览器自己在合成线程上跑，不花我们一分钱。
 * 画布上不行：这里唯一的补间入口是 `Animator`，而它建的每一条补间都要记进帧循环的账
 *（纪律 3.6：真实时钟下没有动画就停帧循环）。一条 `repeat: -1` 的补间等于**帧循环永远停不下来**，
 * 而「等对方出牌」正是一局里最长的一段静止时间。第一版真这么做了，性能剧本当场卡死
 *（bench 的 desktop/play10 和 settle 报「推了 3000 帧还没结束」）。
 * 所以点是印死在字里的：它仍然在说「对面在想」，只是不动。
 */

import { Container, Graphics } from 'pixi.js'
import { Box, type BoxDeps, CANVAS_BACKGROUND } from './Box'

/** 匾上印什么。 */
const LABEL = '对方回合 · · ·'

export type TurnPlaqueDeps = BoxDeps

export class TurnPlaque extends Container {
  /**
   * 垫在匾底下那一块不透明的底。
   *
   * 素方块是空心的，而这块匾**要压住对手那排牌背**：它吊在顶栏下沿、正对着战场居中，
   * 底下就是对手扇形中间那一两张（黑客松版那块深蓝匾体干的就是这件事）。
   * 不垫的话字会印在深色牌背上，读不出来。
   */
  private readonly backdrop = new Graphics()
  private readonly box: Box

  constructor(options: { width: number; height: number }, deps: TurnPlaqueDeps) {
    super()
    this.label = 'turn-plaque'
    // 纯显示：它盖在对手手牌上面，吃了指针事件底下的牌背就点不着了。
    this.eventMode = 'none'
    this.box = new Box({ width: options.width, height: options.height, label: LABEL }, deps)
    this.addChild(this.backdrop, this.box)
    this.paintBackdrop(options.width, options.height)
    this.visible = false
  }

  /** 改大小。只在版式变了时调。 */
  resize(width: number, height: number): void {
    this.box.setSize(width, height)
    this.paintBackdrop(width, height)
  }

  /** 挂出来 / 收回去。 */
  setOn(on: boolean): void {
    this.visible = on
  }

  /** 当场收掉（对局中断时的 `clear-overlays`）。 */
  clear(): void {
    this.visible = false
  }

  private paintBackdrop(width: number, height: number): void {
    this.backdrop.clear().rect(0, 0, width, height).fill({ color: CANVAS_BACKGROUND })
  }
}
