/**
 * 玩家的手指和鼠标：滚卡池、从卡池拖一张进牌组、把牌组里的一张拖回卡池、点卡看大图。
 *
 * 点「＋」「－」那两条不在这里——它们是按钮自己的 `onPress`，由零件表接到场景上。
 * 这里只管**滚动**、**拖拽**和**轻点**，也就是需要状态机的那几件事；
 * 每一段演成什么样归 dragFx.ts，落点和合法性归 logic/。
 *
 * 三个合成入口 `pressAt / moveTo / releaseAt` 原样透出去，交互测试和 bench 剧本按它喂坐标
 *（同对局场景的 input.ts）。真指针只是多了一层 Pixi 事件系统的坐标换算，走的是同一条路。
 *
 * ## 一次按下有三种去向
 *
 * 按在卡上、横着拖 → 抓牌；按在卡上、竖着划（触屏）→ 让给滚动；按在空处 → 直接滚。
 * 判据走 `dragRules.dragGestureOf`（和对局共用），只是判成 `scroll` 之后**不再作废**，
 * 而是把这次按下交给滚动——黑客松那边这一下是浏览器原生滚动接走的。
 *
 * ## 牌组内不换位置
 *
 * 旧版可以在牌组栏里拖着换顺序，这一版**不做**。两个原因：
 * 一是牌序在这个游戏里不影响任何事（开局要洗牌，见 core 的 `GameSetup`）；
 * 二是它和「拖回卡池 = 移除」共用同一次拖拽，落点差几十像素就是两种完全相反的结果。
 * 所以规矩收成一条：**从牌组里拖出来，松手落在牌组栏外面就是移除，落在里面就是什么都没发生。**
 */

import { DRAG_SCALE, dragGestureOf, TOUCH_HOLD_TOLERANCE } from '../../interaction/dragRules'
import { anchorFor } from './anchors'
import type { DeckContext } from './context'
import { followCard, liftCard } from './dragFx'
import { type DragPress, dropBackToPool, dropHome, dropIntoDeck, endDrag } from './drop'
import { cellAt, insideArea } from './hit'
import { insertIndexAt } from './logic/insert'
import { addBlockReason } from './logic/legality'
import { filteredPool, renderDeckScene, shownDeck } from './render'
import type { ScrollState } from './scroll'
import { addCard, currentCards, setDrawerOpen } from './state'

/** 一次按下走到现在的账。松手时按它判「这是拖还是点」。 */
interface Press extends DragPress {
  fromX: number
  fromY: number
  /** 已经过了阈值、真的在拖了。 */
  dragging: boolean
  /** 从按下到现在走了多远（取最大值，不是直线距离）。 */
  moved: number
  /** 跟手那张卡缩到多大（已经乘过 `DRAG_SCALE`）。 */
  ghostScale: number
  /** 触屏那一档要走「滚动优先」的判定（见 dragRules 的 scrollGuard）。 */
  scrollGuard: boolean
}

/** 一次正在跟手的滚动。 */
interface Scrolling {
  state: ScrollState
}

export interface DeckInput {
  pressAt(x: number, y: number, pointerType?: string): void
  moveTo(x: number, y: number): void
  releaseAt(x: number, y: number): void
  /** 滚轮：按指针停在哪一块滚哪一块。返回真的滚动了没有。 */
  wheelAt(x: number, y: number, deltaY: number): boolean
  /** 逐帧推惯性，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
  /** 还在跟手吗。帧循环靠它决定停不停（3.6）。 */
  isBusy(): boolean
  /** 拆掉：把跟手那张卡还回回收池。 */
  destroy(): void
}

export function createDeckInput(ctx: DeckContext): DeckInput {
  let press: Press | null = null
  let scrolling: Scrolling | null = null
  /** 现在是第几毫秒。滚动的瞬时速度按它算，由 `advance` 累加——这一页没有别的时钟。 */
  let nowMs = 0

  /**
   * 牌组栏现在够不够得着。
   *
   * 手机档抽屉收起来时整层挪到了屏幕底下（见 layout/mobileLayout.ts），
   * 那时候卡位的坐标还在，但屏幕上根本看不见——不挡一下的话，
   * 指针在卡池下半截一划就会「抓到」一张看不见的牌。
   */
  const slotsReachable = (): boolean => ctx.layout.drawer === null || ctx.state.drawerOpen
  /** 卡池现在够不够得着。手机档抽屉一展开就把卡池整层藏起来了（见 render 的 renderDrawer）。 */
  const poolReachable = (): boolean => ctx.layout.drawer === null || !ctx.state.drawerOpen

  const slotView = () => ctx.layout.slotScroll?.view ?? null
  const poolView = () => ctx.layout.poolScroll?.view ?? null
  const inSlots = (x: number, y: number): boolean =>
    slotsReachable() && insideArea(ctx.layout.slots, slotView(), { x, y })
  const inPool = (x: number, y: number): boolean =>
    poolReachable() && insideArea(ctx.layout.poolGrid, poolView(), { x, y })

  /** 指针底下压着哪张卡（先看牌组栏，再看卡池——牌组栏在手机档是浮在卡池上的抽屉）。 */
  const cardUnder = (x: number, y: number): Press['origin'] | null => {
    const point = { x, y }
    if (inSlots(x, y)) {
      const deck = shownDeck(ctx)
      const hit = cellAt(ctx.layout.slots, point, deck.length, ctx.slotScroll.offset)
      const cardId = hit === null ? undefined : deck[hit.index]
      if (hit !== null && cardId !== undefined) return { from: 'deck', cardId, index: hit.index }
      return null
    }
    if (inPool(x, y)) {
      const all = filteredPool(ctx)
      const hit = cellAt(ctx.layout.poolGrid, point, all.length, ctx.poolScroll.offset)
      const entry = hit === null ? undefined : all[hit.index]
      if (hit !== null && entry !== undefined) {
        return { from: 'pool', cardId: entry.cardId, index: hit.index }
      }
    }
    return null
  }

  /** 指针停在哪一块滚动区上。两块都不在（或者那一档根本不滚）就是 null。 */
  const scrollUnder = (x: number, y: number): ScrollState | null => {
    if (slotView() !== null && inSlots(x, y)) return ctx.slotScroll
    if (poolView() !== null && inPool(x, y)) return ctx.poolScroll
    return null
  }

  /** 跟手那张卡在哪档缩放上。卡池那张本来就画得大，拖起来不该突然缩成卡位那么小。 */
  const dragScaleOf = (from: 'pool' | 'deck'): number =>
    from === 'pool' ? ctx.layout.poolCardScale : ctx.layout.slotCardScale

  /** 让跟手那张卡贴着指针：卡的原点在底边中点，所以要往下让半张卡高。 */
  const follow = (state: Press, x: number, y: number): void => {
    const ghost = state.ghost
    if (ghost === null) return
    const point = anchorFor(x, y, state.ghostScale)
    followCard(ctx.animator, ghost, point.x, point.y)
    ctx.wake()
  }

  /** 起拖：建一张跟手的卡，原位空出来。 */
  const beginDrag = (state: Press, x: number, y: number): void => {
    state.dragging = true
    ctx.dragging = state.origin
    /*
     * 手机档：从卡池抓起一张牌，抽屉**自己升起来**。
     *
     * 不这么做的话这一档根本拖不动——抽屉收着时牌组栏在屏幕外面，而它一旦展开又盖住了卡池，
     * 玩家永远没法「一手抓着卡、一眼看见要放哪儿」。放完不自动收回去：刚加进去的那张就在眼前。
     */
    if (state.origin.from === 'pool' && ctx.layout.drawer !== null && !ctx.state.drawerOpen) {
      ctx.state = setDrawerOpen(ctx.state, true)
    }
    const ghost = ctx.holdCard(state.origin.cardId, `drag:${state.origin.cardId}`)
    const base = dragScaleOf(state.origin.from)
    state.ghostScale = base * DRAG_SCALE
    const start = anchorFor(state.fromX, state.fromY, state.ghostScale)
    ghost.position.set(start.x, start.y)
    liftCard(ctx.animator, ghost, base, base)
    ctx.parts.layers.drag.addChild(ghost)
    state.ghost = ghost
    follow(state, x, y)
    renderDeckScene(ctx)
  }

  return {
    pressAt(x, y, pointerType = 'mouse') {
      const origin = cardUnder(x, y)
      if (origin === null) {
        // 按在空处：直接跟手滚。按在卡上的那一条要等方向判出来才知道是拖还是滚。
        const state = scrollUnder(x, y)
        if (state === null) return
        state.beginDrag(y, nowMs)
        scrolling = { state }
        return
      }
      press = {
        fromX: x,
        fromY: y,
        origin,
        dragging: false,
        moved: 0,
        ghost: null,
        ghostScale: 1,
        /*
         * 卡池是一块能滚的网格，触屏上手指落点几乎必然压在某张卡上，
         * 所以那一档走「滚动优先」的判定（见 dragRules 的 scrollGuard）。
         * 鼠标不受影响：`dragGestureOf` 只在 scrollGuard 为真时才分方向。
         */
        scrollGuard: pointerType !== 'mouse',
      }
    },

    moveTo(x, y) {
      if (scrolling !== null) {
        if (scrolling.state.dragTo(y, nowMs)) renderDeckScene(ctx)
        return
      }
      const state = press
      if (state === null) return
      const dx = x - state.fromX
      const dy = y - state.fromY
      state.moved = Math.max(state.moved, Math.hypot(dx, dy))
      if (!state.dragging) {
        const gesture = dragGestureOf({ dx, dy, scrollGuard: state.scrollGuard })
        if (gesture === 'scroll') {
          /*
           * 判成滚动：这次按下改判给滚动，而不是像从前那样整个作废。
           * 起点用**按下那一刻**的位置，中间这段位移因此不会被吃掉——手指划到哪儿，
           * 内容就跟到哪儿（黑客松那边这一下是浏览器原生滚动接走的）。
           */
          press = null
          const area = scrollUnder(state.fromX, state.fromY)
          if (area === null) return
          area.beginDrag(state.fromY, nowMs)
          scrolling = { state: area }
          if (area.dragTo(y, nowMs)) renderDeckScene(ctx)
          return
        }
        if (gesture !== 'drag') return
        beginDrag(state, x, y)
        return
      }
      follow(state, x, y)
      /*
       * 让位：指针在牌组栏里才让，出去就收起来。
       * **从牌组里拖出来的那张不让位**——它本来就占着一格，再让一格等于凭空多出一个空位。
       */
      const gap =
        state.origin.from === 'pool' && inSlots(x, y)
          ? insertIndexAt({
              grid: ctx.layout.slots,
              deckLength: currentCards(ctx.state).length,
              gap: ctx.gap,
              point: { x, y: y + ctx.slotScroll.offset },
            })
          : null
      if (gap === ctx.gap) return
      ctx.gap = gap
      renderDeckScene(ctx)
    },

    releaseAt(x, y) {
      if (scrolling !== null) {
        scrolling.state.endDrag()
        scrolling = null
        ctx.wake()
        return
      }
      const state = press
      press = null
      if (state === null) return

      if (!state.dragging) {
        /*
         * 没起拖 = 点了一下 = 放大查看。
         * 触屏上「斜着划了一大段、两条阈值都没过」不该算点击，所以那一档要再看一眼位移。
         */
        const tapped = !state.scrollGuard || state.moved <= TOUCH_HOLD_TOLERANCE
        if (tapped) ctx.emitInspect(state.origin)
        return
      }

      if (state.origin.from === 'pool') {
        if (inSlots(x, y)) dropIntoDeck(ctx, state, x, y)
        else dropHome(ctx, state)
        return
      }
      // 从牌组里拖出来：松手落在栏外是移除，落在栏里是什么都没发生（不换位置）。
      if (inSlots(x, y)) dropHome(ctx, state)
      else dropBackToPool(ctx, state)
    },

    wheelAt(x, y, deltaY) {
      const state = scrollUnder(x, y)
      if (state === null || !state.scrollBy(deltaY)) return false
      renderDeckScene(ctx)
      return true
    },

    advance(deltaMs) {
      nowMs += deltaMs
      let busy = false
      if (ctx.poolScroll.advance(deltaMs)) busy = true
      if (ctx.slotScroll.advance(deltaMs)) busy = true
      if (busy) renderDeckScene(ctx)
      return busy || press?.dragging === true
    },

    isBusy: () => press?.dragging === true || scrolling !== null,

    destroy() {
      if (press !== null) endDrag(ctx, press)
      press = null
      scrolling = null
    },
  }
}

/** 点卡池第 index 张的「＋」：按当前视野里第一格插进去。落点口径见 scroll.ts。 */
export function addFromPool(ctx: DeckContext, index: number, at: number): boolean {
  const entry = filteredPool(ctx)[index]
  if (entry === undefined) return false
  const blocked = addBlockReason({
    deck: currentCards(ctx.state),
    cardId: entry.cardId,
    rules: ctx.rules,
    blockedReason: entry.blockedReason,
  })
  if (blocked !== null) {
    ctx.refuse(entry.cardId, null)
    return false
  }
  ctx.state = addCard(ctx.state, entry.cardId, at)
  ctx.emitChange()
  renderDeckScene(ctx)
  return true
}
