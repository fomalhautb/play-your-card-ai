/**
 * 「对方回合」吊匾：等对方出牌的那一段，从顶栏下沿吊下来的一块方块，
 * 后面跟着三个一直在跳的点。
 *
 * 黑客松版有这一块（`.battle__turn-plaque`），正式版一直缺（`Panel` 里那个变体建好了没人摆）。
 * 正式版简化第 4 步之二把它补回来，同时剥成素方块（见 components/Box.ts）：
 * 两根挂绳、双线框、墨蓝底都不画了，只剩一圈描边加一行字。
 *
 * 三个点的跳动改成**文字逐帧变化**：素方块只印一行字，画不出三颗各自错开相位的圆点，
 * 所以改成「对方回合」后面的点一个一个加上去再清零。周期照旧 1.4 秒（`styles.css` 的
 * `battle-turn-plaque-dot`），四拍各 0.35 秒。
 *
 * 这一段是 `repeat: -1` 的补间，**收起来时必须把它掐掉**：不掐帧循环就永远认为
 * 「还有东西在动」，停不下来（3.6）。`setOn(false)` 和 `clear()` 都会掐。
 */

import { Container } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'

/** 匾上印的那句话，以及后面那几档点。 */
const LABEL = '对方回合'
const DOTS = ['', ' ·', ' · ·', ' · · ·'] as const
/** 一整圈跳完多久（秒）。抄 `styles.css` 的 `battle-turn-plaque-dot` 的 1.4s。 */
const CYCLE = 1.4

export type TurnPlaqueDeps = BoxDeps & {
  animator: Animator
}

export class TurnPlaque extends Container {
  private readonly deps: TurnPlaqueDeps
  private readonly box: Box
  /** 跳动补间补的是这个普通对象，不是显示对象——它本身没有任何属性要动，只要一个节拍。 */
  private readonly beat = { value: 0 }
  private phase = 0
  /** 现在挂着没有。名字不能叫 `on`——那是 Container 自带的事件方法。 */
  private showing = false

  constructor(options: { width: number; height: number }, deps: TurnPlaqueDeps) {
    super()
    this.deps = deps
    this.label = 'turn-plaque'
    // 纯显示：它盖在对手手牌上面，吃了指针事件底下的牌背就点不着了。
    this.eventMode = 'none'
    this.box = new Box({ width: options.width, height: options.height, label: LABEL }, deps)
    this.addChild(this.box)
    this.visible = false
  }

  /** 改大小。只在版式变了时调。 */
  resize(width: number, height: number): void {
    this.box.setSize(width, height)
  }

  /** 挂出来 / 收回去。重复设成同一档什么都不做。 */
  setOn(on: boolean): void {
    if (on === this.showing) return
    this.showing = on
    this.visible = on
    this.deps.animator.killTweensOf(this.beat)
    if (!on) return
    // 每次挂出来都从第一拍开始（同旧样式把动画挂在 `[data-on]` 上）。
    this.phase = 0
    this.box.setLabel(LABEL)
    this.beat.value = 0
    this.deps.animator.tween(this.beat, {
      value: 1,
      duration: CYCLE / DOTS.length,
      repeat: -1,
      ease: 'none',
      onRepeat: () => this.step(),
    })
  }

  /** 当场收掉（对局中断时的 `clear-overlays`，以及销毁之前）。 */
  clear(): void {
    this.showing = false
    this.visible = false
    this.deps.animator.killTweensOf(this.beat)
  }

  private step(): void {
    this.phase = (this.phase + 1) % DOTS.length
    this.box.setLabel(`${LABEL}${DOTS[this.phase]}`)
  }
}
