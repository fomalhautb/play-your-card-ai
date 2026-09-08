/**
 * 场景里所有补间的唯一入口，顺带记着"现在还有几条在跑"。
 *
 * 为什么要自己记而不去问 GSAP：帧循环每帧都要判一次"还忙不忙"（3.6 要求没动画就停），
 * 而 GSAP 公开的问法 `globalTimeline.getChildren()` 每次都要新建一个数组，
 * 稳态每帧堆分配那条（3.10）不该被这种查询占掉。这里改成建的时候加一笔、
 * 结束或被打断时减一笔，判忙就是读一个数。
 *
 * 减账靠 GSAP 的两个回调，三条路都盖到了：正常演完走 onComplete；被 `overwrite: 'auto'`
 * 顶掉、或者被我们自己 kill 掉都走 onInterrupt（GSAP 内部的 _interrupt 会发这个回调）。
 * 每条补间只减一次——Set.delete 对已经删掉的键返回 false，重复调用是安全的。
 */

import gsap from 'gsap'

type Vars = gsap.TweenVars
type TimelineVars = gsap.TimelineVars

/** 一条补间的收尾回调，包一层之后仍然会调用调用方原来给的那个。 */
interface Settled {
  onComplete?: gsap.Callback
  onInterrupt?: gsap.Callback
}

export class Animator {
  /** 还在跑（含还在等 delay）的补间和时间线。 */
  private readonly live = new Set<gsap.core.Animation>()
  private readonly onWake: () => void
  private destroyed = false

  /**
   * @param onWake 有新动画开跑时叫一声，让帧循环醒过来。
   *   建补间的那一刻就叫，不等它真的开始跑——带 delay 的补间在等待期间也算"有事在做"，
   *   帧循环停了就没人到点去启动它了。
   */
  constructor(onWake: () => void) {
    this.onWake = onWake
  }

  /** 场景里现在还有没有在播的东西。 */
  isBusy(): boolean {
    return this.live.size > 0
  }

  /** 建一条补间。vars 原样透传给 GSAP，只是把两个收尾回调包了一层。 */
  tween(target: object | object[], vars: Vars): gsap.core.Tween {
    return this.run(vars, (wrapped) => gsap.to(target, wrapped))
  }

  /** 建一条从指定起点跑的补间。进场动画要用：起点是牌库位置，不是元素当前的位置。 */
  fromTo(target: object | object[], from: Vars, to: Vars): gsap.core.Tween {
    return this.run(to, (wrapped) => gsap.fromTo(target, from, wrapped))
  }

  /** 建一条时间线。里面的子补间不单独记账——整条线记一笔就够了。 */
  timeline(vars: TimelineVars = {}): gsap.core.Timeline {
    return this.run(vars, (wrapped) => gsap.timeline(wrapped))
  }

  /**
   * 建一条演完就 resolve 的时间线。
   *
   * 场景对外的 deal / playCard / flip 都是"演完再 resolve"的 Promise。
   * 被打断（比如场景销毁）时也要 resolve——不然调用方会永远 await 下去。
   */
  timelineAsync(vars: TimelineVars = {}): { timeline: gsap.core.Timeline; done: Promise<void> } {
    let settle = (): void => {}
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })
    const timeline = this.timeline({
      ...vars,
      onComplete: () => {
        vars.onComplete?.()
        settle()
      },
      onInterrupt: () => {
        vars.onInterrupt?.()
        settle()
      },
    })
    return { timeline, done }
  }

  /** 立刻停掉某个对象身上的所有补间。被停的那条会走 onInterrupt，账自己会平。 */
  killTweensOf(target: object | object[]): void {
    gsap.killTweensOf(target)
  }

  /** 场景销毁：把还在跑的全停掉，让各自的 onInterrupt 把账清干净。 */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    // kill 会触发 onInterrupt，而那个回调会改 this.live，所以先复制一份再遍历。
    for (const animation of [...this.live]) animation.kill()
    this.live.clear()
  }

  /**
   * 建动画的公共路子：包收尾回调、登记、叫醒帧循环。
   *
   * `self` 要等 make 返回才拿得到，而理论上零时长的补间可能在 make 里就演完了，
   * 所以用 settledEarly 兜一手：真出现那种情况就在登记之后立刻销账，不留死账。
   */
  private run<A extends gsap.core.Animation, V extends Settled>(
    vars: V,
    make: (wrapped: V) => A,
  ): A {
    let self: A | null = null
    let settledEarly = false
    const settle = (): void => {
      if (self === null) settledEarly = true
      else this.live.delete(self)
    }
    const wrapped: V = {
      ...vars,
      onComplete: () => {
        vars.onComplete?.()
        settle()
      },
      onInterrupt: () => {
        vars.onInterrupt?.()
        settle()
      },
    }
    const animation = make(wrapped)
    self = animation
    if (this.destroyed || settledEarly) {
      animation.kill()
      return animation
    }
    this.live.add(animation)
    this.onWake()
    return animation
  }
}
