/**
 * 帧循环：没有动画就彻底停下（《正式版架构》3.6），需要确定性时改成手动一帧一帧推。
 *
 * 时间只有一个来源。GSAP 默认自己挂在 requestAnimationFrame 上推进整棵补间树，
 * 那条时间线我们管不着，也就没法在"没有动画"的那一刻把它按停，更没法在测试里定步长。
 * 所以这里按 GSAP 官方的手动驱动写法把它摘下来（`gsap.ticker.remove(gsap.updateRoot)`），
 * 之后补间的时间全靠本模块调 `gsap.updateRoot(秒)` 喂。
 *
 * 摘下来之后还要收一个尾巴：GSAP 每建一条补间都会叫醒自己那台 ticker，
 * 而它的监听表已经空了，醒着只是每帧空跑一次 rAF。所以每推进完一帧就顺手让它睡回去
 * （见 advance 末尾），空闲时整个页面一次 rAF 都不发。
 *
 * 计数器是给 `packages/bench` 打分用的，对应 6.9 的「空闲时帧循环」和渲染次数两项。
 */

import gsap from 'gsap'

/** 同时在手动驱动 GSAP 的帧循环数量，用来决定什么时候把 GSAP 的时钟还回去。 */
let manualDrivers = 0

/**
 * 接管 GSAP 的根时间线。第一个接管的人负责摘掉 GSAP 自己的 ticker。
 * 引用计数是因为同一个页面可能开着不止一个场景（开发页切档位时会重建），
 * 谁最后走谁把时钟还回去，中间那些人不能把别人的时间线掐了。
 */
function acquireGsapRoot(): void {
  manualDrivers += 1
  if (manualDrivers > 1) return
  gsap.ticker.remove(gsap.updateRoot)
  gsap.ticker.sleep()
}

/**
 * 还回 GSAP 的时钟：最后一个手动驱动的人走了才还。
 *
 * **`gsap.ticker.wake()` 会当场同步跑一帧**（GSAP 内部的 `_tick(2)`），而那一帧喂给
 * `updateRoot` 的是 ticker 自己的墙钟时间——通常比我们手动推到的时刻靠后几十秒。
 * 也就是说：还时钟这一下会把**还活着的补间一口气演到终点**。
 * 所以拆场景时必须先把补间全掐掉再调它（见 DuelScene 的 destroy），
 * 否则那一帧会写到已经被清场销毁的对象上，当场抛 TypeError。
 */
function releaseGsapRoot(): void {
  manualDrivers -= 1
  if (manualDrivers > 0) return
  gsap.ticker.add(gsap.updateRoot)
  gsap.ticker.wake()
}

export interface FrameLoopCounters {
  /** 调了多少次渲染。手动步进和自动帧循环都算。 */
  renders: number
  /**
   * 自动帧循环的回调跑了多少次。
   * 手动时钟下恒为 0——那正是"没注册任何真实时间源"的证据（对应 6.9 的「空闲时帧循环」）。
   */
  frameRequests: number
  /**
   * 帧循环真正在跑的累计毫秒数：相邻两次真实时钟帧回调之间的间隔之和。
   *
   * 拿它当帧率的分母。没有动画时循环会整个停下（3.6），墙钟时间照走而渲染次数不涨，
   * 用墙钟当分母算出来的帧率会被空闲摊薄——动画刚停那一下显示十几而不是六十。
   * 这个数把空闲那段排掉：循环停下再醒来时从新的第一帧重新开始计间隔。
   *
   * 每一轮的第一帧不计（没有上一帧，间隔无从算起）。
   * 手动时钟（step()）下恒为 0：那边的时间是调用方定的，墙钟对它没有意义。
   */
  activeMs: number
}

export interface FrameLoopOptions {
  /** true 时不注册任何真实时间源，只认 step()。 */
  manual: boolean
  /**
   * 画一帧。补间已经推进过了，这里负责把逐帧跟随（拖拽、倾斜）也推一步再把画面交出去。
   * deltaMs 是这一帧推进了多久，两种时钟下含义一样。
   */
  render: (deltaMs: number) => void
  /** 还有没有在播的动画。返回 false 时帧循环停下。 */
  isBusy: () => boolean
}

/**
 * 一帧最多推进多少毫秒。
 *
 * 标签页切回来时两次 rAF 的间隔可能是好几秒，照实喂给 GSAP 的话所有补间会一口气跳到终点，
 * 玩家看到的是"演出全没了"。夹到 100ms（约 6 帧）之后最坏也只是慢动作一下。
 * 手动步进不受这条管：那边的步长是调用方定的，夹一刀反而破坏确定性。
 */
const MAX_FRAME_MS = 100

export class FrameLoop {
  private readonly options: FrameLoopOptions
  /** 虚拟时钟，单位毫秒。GSAP 要的是秒，喂进去之前除以 1000。 */
  private elapsedMs = 0
  /** 有人改了画面但当时没有补间在跑（resize、上下文恢复），下一帧得补画一次。 */
  private dirty = true
  private rafId: number | null = null
  private lastStamp = 0
  /**
   * 上一次真实时钟帧回调的时间戳。null 表示这一轮还没有上一帧——
   * 刚 wake() 起来或者循环刚停下，此时不该往 activeMs 里加任何东西。
   */
  private lastActiveStamp: number | null = null
  private activeMs = 0
  private renders = 0
  private frameRequests = 0
  private destroyed = false

  constructor(options: FrameLoopOptions) {
    this.options = options
    acquireGsapRoot()
    // 起手先把根时间线对到 0：GSAP 的根时间线是全局的，上一个场景可能已经把它推到很后面了。
    gsap.updateRoot(0)
  }

  /**
   * 手动推进一帧：先把补间推到新时刻，画面有变化才画。
   *
   * 空闲时不画，和真实时钟下"没有动画就停下"是同一条纪律（3.6）：
   * 性能剧本跑完之后会空转几十帧，那几帧里一次渲染都不该发生，
   * 有的话就说明还有东西在偷偷动。确定性不受影响——同一段剧本推出来的渲染次数是固定的。
   */
  step(deltaMs: number): void {
    if (this.destroyed) return
    this.advance(deltaMs)
  }

  /**
   * 有新动画了，把帧循环叫醒。手动时钟下什么都不做（时间由调用方推）。
   * 重复调用是安全的：已经在跑就直接返回。
   */
  wake(): void {
    if (this.destroyed) return
    this.dirty = true
    if (this.options.manual || this.rafId !== null) return
    this.lastStamp = performance.now()
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 帧循环有没有停下来。手动时钟下永远是 true——那边压根没有循环。 */
  isIdle(): boolean {
    return this.rafId === null
  }

  counters(): FrameLoopCounters {
    return {
      renders: this.renders,
      frameRequests: this.frameRequests,
      activeMs: this.activeMs,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stop()
    releaseGsapRoot()
  }

  private readonly tick = (stamp: number): void => {
    this.rafId = null
    this.frameRequests += 1
    const delta = Math.min(MAX_FRAME_MS, Math.max(0, stamp - this.lastStamp))
    /*
     * activeMs 记的是"循环在跑"的墙钟时间，所以只累计真正的帧间隔，
     * 而且和 renders 在同一个回调里更新——两个数错位一帧，算出来的帧率就是错的。
     * 这里不夹 MAX_FRAME_MS：卡了三百毫秒就是真卡了三百毫秒，
     * 夹一刀等于把卡顿从帧率里抹掉，而帧率正是用来看卡顿的。
     */
    if (this.lastActiveStamp !== null) {
      this.activeMs += Math.max(0, stamp - this.lastActiveStamp)
    }
    this.lastActiveStamp = stamp
    this.lastStamp = stamp
    this.advance(delta)
    /*
     * 这一帧演完还有东西在动才继续排下一帧；没有就停在这儿，直到下一次 wake()。
     * 先看 rafId：advance 里的补间回调可能建了新补间并顺手 wake() 过，下一帧已经排好了，
     * 再排一次就会有两条 rAF 链，同一时刻跑两遍回调（帧间隔 0、渲染 +1，帧率虚高）。
     */
    if (!this.destroyed && this.rafId === null && this.options.isBusy()) {
      this.rafId = requestAnimationFrame(this.tick)
    }
    // 循环在这一帧停下了：下次醒来重新开始计间隔，中间那段空闲不进 activeMs。
    if (this.rafId === null) this.lastActiveStamp = null
  }

  private advance(deltaMs: number): void {
    // 推进之前先问一次忙不忙：这一帧 updateRoot 会把最后一条补间演完并销账，
    // 只看推进之后的结果，收尾那一帧的终点位置就画不出来了。
    const wasBusy = this.options.isBusy()
    this.elapsedMs += deltaMs
    gsap.updateRoot(this.elapsedMs / 1000)
    const needsRender = this.dirty || wasBusy || this.options.isBusy()
    if (needsRender) {
      this.renders += 1
      this.options.render(deltaMs)
    }
    /*
     * 这一帧的标脏在**画完之后**才清。
     *
     * 场景在 render 回调里做的事（播一条 cue、和局面对账、推指针跟随）都排在真正的
     * 绘制之前，所以它们顺手叫的那几次 wake() 说的是「我刚改了画面」——而这一帧已经画过了。
     * 清在前面的话，那几次 wake 会留到下一帧变成一次多余的渲染，
     * 而「没有动画时停掉帧循环」（3.6）那条计数器数的正是这种多出来的一帧。
     * 真正还有东西在动的情况不受影响：那时 isBusy() 为真，下一帧照样画。
     */
    this.dirty = false
    // 补间回调里可能又建了新补间，GSAP 会顺手叫醒它自己那台空转的 ticker，这里按回去。
    gsap.ticker.sleep()
  }

  private stop(): void {
    this.lastActiveStamp = null
    if (this.rafId === null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
  }
}
