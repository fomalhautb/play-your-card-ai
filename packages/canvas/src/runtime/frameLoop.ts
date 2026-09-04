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

/** 还回 GSAP 的时钟：最后一个手动驱动的人走了才还。 */
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
  private rafId: number | null = null
  private lastStamp = 0
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
   * 手动推进一帧：先把补间推到新时刻，再画。
   * 空闲时照样推进和渲染——调用方要的是"一步一帧"的确定性，不是省电。
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
    if (this.destroyed || this.options.manual || this.rafId !== null) return
    this.lastStamp = performance.now()
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 帧循环有没有停下来。手动时钟下永远是 true——那边压根没有循环。 */
  isIdle(): boolean {
    return this.rafId === null
  }

  counters(): FrameLoopCounters {
    return { renders: this.renders, frameRequests: this.frameRequests }
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
    this.lastStamp = stamp
    this.advance(delta)
    // 这一帧演完还有东西在动才继续排下一帧；没有就停在这儿，直到下一次 wake()。
    if (!this.destroyed && this.options.isBusy()) {
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  private advance(deltaMs: number): void {
    this.elapsedMs += deltaMs
    gsap.updateRoot(this.elapsedMs / 1000)
    this.renders += 1
    this.options.render(deltaMs)
    // 补间回调里可能又建了新补间，GSAP 会顺手叫醒它自己那台空转的 ticker，这里按回去。
    gsap.ticker.sleep()
  }

  private stop(): void {
    if (this.rafId === null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
  }
}
