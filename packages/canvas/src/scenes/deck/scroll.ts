/**
 * 构筑页两块滚动区的算术：内容有多高、滚到哪儿、滑块画在哪儿、松手之后还能滑多远。
 *
 * 画布上没有现成的滚动容器，这一份就是自己那一套。刻意只放**数**，不碰 Pixi：
 * 「滚到底停住」「甩一下之后滑多久」这两件事是滚动手感的全部，也最容易改坏，
 * 所以它们要能在 vitest 里直接喂数字断言（见 canvas/test/deckScroll.test.ts）。
 *
 * 惯性用指数衰减模拟浏览器原生的那一下（黑客松那边是 `overflow-y: auto` 配
 * `touch-action: pan-y`，惯性由浏览器给）。同 `cardTilt` 的理由：按时间常数收敛，
 * 帧率变了手感不跟着变，手动步进和真实时钟下是同一套。
 */

import type { GridSpec } from '../../layout/gridMath'
import { clamp } from './layout/types'

/**
 * 甩出去之后速度衰减的时间常数（秒）。
 *
 * 0.325 是各家原生滚动惯性的常见档：一秒之后只剩 4.6% 的速度，
 * 「甩一下滑过两三屏然后停住」这个观感就是它给的。
 */
const FLICK_TAU = 0.325
/** 慢到这个速度（像素每秒）就直接停住。半帧挪不到一个像素，再滑也看不出来。 */
const FLICK_STOP = 40
/**
 * 松手时能带走的最大速度（像素每秒）。
 *
 * 不封顶的话，触屏上一次很短的快划会算出上万的速度，一甩就直接到底。
 */
const FLICK_MAX = 4000

/** 一行格子占多高（含行间距）。滚动按它分行。 */
export function rowStep(grid: GridSpec): number {
  return grid.cellHeight + grid.gapY
}

/** count 个格子排成 `grid.columns` 列，内容一共多高。 */
export function contentHeight(grid: GridSpec, count: number): number {
  const rows = Math.ceil(Math.max(0, count) / grid.columns)
  return rows <= 0 ? 0 : rows * grid.cellHeight + (rows - 1) * grid.gapY
}

/** 最多能滚多远。内容比窗口矮就是 0（那时候整块钉在顶上不动）。 */
export function maxScroll(viewHeight: number, contentHigh: number): number {
  return Math.max(0, contentHigh - viewHeight)
}

/**
 * 滚动量是 offset 时，窗口顶边压在第几行上。
 *
 * 取下整：露了半行也算那一行已经进了窗口，格子要从它开始摆。
 */
export function firstVisibleRow(offset: number, step: number): number {
  return step <= 0 ? 0 : Math.max(0, Math.floor(offset / step))
}

/**
 * 点「＋」时这张牌插进牌组的第几个之前：**当前视野里第一格**。
 *
 * 语义照抄黑客松的 `pageInsertIndex`（它量的是 `scrollTop` 落在哪一行）：接在末尾的话，
 * 牌组超过一屏时新牌会落到眼前看不见的地方，玩家会以为这一下没生效。
 * 视野已经滚过了牌组末尾时接在末尾——那一屏上一张牌都没有，「第一格」指不到任何东西。
 */
export function scrollInsertIndex(offset: number, grid: GridSpec, deckLength: number): number {
  const first = firstVisibleRow(offset, rowStep(grid)) * grid.columns
  return Math.min(Math.max(0, first), deckLength)
}

/**
 * 滑块画在轨的哪一段。
 *
 * 长度按「窗口占内容的几成」算，再兜一个最小长度——内容很长时按比例算出来的滑块
 * 只有几个像素高，看着像一粒灰尘，也捏不住。
 */
export function thumbSpan(
  barHeight: number,
  viewHeight: number,
  contentHigh: number,
  offset: number,
  minLength = 26,
): { y: number; height: number } {
  const max = maxScroll(viewHeight, contentHigh)
  if (max <= 0) return { y: 0, height: barHeight }
  const length = clamp((viewHeight / contentHigh) * barHeight, minLength, barHeight)
  return { y: ((barHeight - length) * clamp(offset, 0, max)) / max, height: length }
}

/**
 * 一块滚动区此刻的状态：滚到哪儿了、手还在不在上面、松手之后还有多少惯性。
 *
 * 上限由调用方每次重排画面时写进来（`setContent`）——内容有多高只有场景知道
 *（筛选一变卡池就少一截），版式算不出来。
 */
export class ScrollState {
  private offsetValue = 0
  private viewHeight = 0
  private contentHigh = 0
  /** 像素每秒。只有松手之后才非零。 */
  private velocity = 0
  /** 上一次跟手的位置和时刻，松手时按它算甩出去的速度。 */
  private lastPoint = 0
  private lastAt = 0
  private dragging = false

  get offset(): number {
    return this.offsetValue
  }

  /** 还能往下滚多远。滑块和「到底了没有」都按它算。 */
  get max(): number {
    return maxScroll(this.viewHeight, this.contentHigh)
  }

  get view(): number {
    return this.viewHeight
  }

  get content(): number {
    return this.contentHigh
  }

  /** 窗口和内容各多高。内容缩短时把滚动量夹回来，返回滚动量有没有因此变过。 */
  setContent(viewHeight: number, contentHigh: number): boolean {
    this.viewHeight = viewHeight
    this.contentHigh = contentHigh
    return this.clampOffset()
  }

  /** 直接滚这么多（滚轮、跟手都走它）。返回真的滚动了没有。 */
  scrollBy(delta: number): boolean {
    return this.scrollTo(this.offsetValue + delta)
  }

  scrollTo(next: number): boolean {
    const clamped = clamp(next, 0, this.max)
    if (clamped === this.offsetValue) return false
    this.offsetValue = clamped
    return true
  }

  /** 回到顶上，惯性一并清掉。换筛选、换牌组时用。 */
  reset(): void {
    this.offsetValue = 0
    this.velocity = 0
    this.dragging = false
  }

  /** 手指 / 鼠标按住了：从这一刻起跟手，惯性先停掉。 */
  beginDrag(pointerY: number, nowMs: number): void {
    this.dragging = true
    this.velocity = 0
    this.lastPoint = pointerY
    this.lastAt = nowMs
  }

  /**
   * 跟手：指针往下走内容就跟着往下走，也就是滚动量减。
   * 顺手记一笔瞬时速度，松手要拿它甩出去。
   */
  dragTo(pointerY: number, nowMs: number): boolean {
    if (!this.dragging) return false
    const dy = pointerY - this.lastPoint
    const dt = (nowMs - this.lastAt) / 1000
    // 两次事件同一毫秒时不更新速度：除以 0 会得到 Infinity，一松手就直接甩到底。
    if (dt > 0) this.velocity = clamp(-dy / dt, -FLICK_MAX, FLICK_MAX)
    this.lastPoint = pointerY
    this.lastAt = nowMs
    return this.scrollBy(-dy)
  }

  /** 松手：把最后记下的速度交给惯性。已经到头的话直接停住。 */
  endDrag(): void {
    this.dragging = false
    if (this.max <= 0) this.velocity = 0
  }

  /** 手还按着吗。按着的时候帧循环不能停（3.6）。 */
  get held(): boolean {
    return this.dragging
  }

  /** 惯性推一帧，返回还在不在动。 */
  advance(deltaMs: number): boolean {
    if (this.dragging) return true
    if (this.velocity === 0) return false
    const dt = deltaMs / 1000
    this.scrollBy(this.velocity * dt)
    this.velocity *= Math.exp(-dt / FLICK_TAU)
    // 到头了就别接着空转：滚动量已经被夹住，再衰减只是让帧循环白转一秒。
    if (Math.abs(this.velocity) < FLICK_STOP || this.atEdge()) {
      this.velocity = 0
      return false
    }
    return true
  }

  private atEdge(): boolean {
    return (
      (this.velocity < 0 && this.offsetValue <= 0) ||
      (this.velocity > 0 && this.offsetValue >= this.max)
    )
  }

  private clampOffset(): boolean {
    const clamped = clamp(this.offsetValue, 0, this.max)
    if (clamped === this.offsetValue) return false
    this.offsetValue = clamped
    return true
  }
}
