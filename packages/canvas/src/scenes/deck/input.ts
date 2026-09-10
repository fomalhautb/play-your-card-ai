/**
 * 玩家的手指和鼠标：从卡池拖一张进牌组、把牌组里的一张拖回卡池、点卡看大图。
 *
 * 点「＋」「－」那两条不在这里——它们是按钮自己的 `onActivate`，由零件表接到场景上。
 * 这里只管**拖拽**和**轻点**，也就是需要状态机的那一半。
 *
 * 三个合成入口 `pressAt / moveTo / releaseAt` 原样透出去，交互测试和 bench 剧本按它喂坐标
 *（同对局场景的 input.ts）。真指针只是多了一层 Pixi 事件系统的坐标换算，走的是同一条路。
 *
 * ## 牌组内不换位置
 *
 * 旧版可以在牌组栏里拖着换顺序，这一版**不做**。两个原因：
 * 一是牌序在这个游戏里不影响任何事（开局要洗牌，见 core 的 `GameSetup`），
 * 旧版留着它更多是因为 DOM 拖拽本来就顺手；
 * 二是它和「拖回卡池 = 移除」共用同一次拖拽，落点差几十像素就是两种完全相反的结果，
 * 而这一页的卡位只有六七十像素宽。所以规矩收成一条：
 * **从牌组里拖出来，松手落在牌组栏外面就是移除，落在里面就是什么都没发生。**
 */

import type { CardId } from '@ai-duel/core'
import type { CardSprite } from '../../components/CardSprite'
import { DRAG_SCALE, dragGestureOf, TOUCH_HOLD_TOLERANCE } from '../../interaction/dragRules'
import { CARD_HEIGHT } from '../../layout/fanMath'
import { insideGrid, nearestCell } from '../../layout/gridMath'
import type { DeckContext } from './context'
import { insertIndexAt } from './logic/insert'
import { addBlockReason } from './logic/legality'
import { renderDeckScene, shownDeck, visiblePool } from './render'
import { addCard, currentCards, removeAt } from './state'

/** 一次按下走到现在的账。松手时按它判「这是拖还是点」。 */
interface Press {
  /** 按下的位置。 */
  fromX: number
  fromY: number
  /** 按在哪张卡上。 */
  origin: { from: 'pool' | 'deck'; cardId: CardId; index: number }
  /** 已经过了阈值、真的在拖了。 */
  dragging: boolean
  /** 从按下到现在走了多远（取最大值，不是直线距离）。 */
  moved: number
  /** 跟着指针跑的那张卡。起拖之后才建。 */
  ghost: CardSprite | null
  /** 跟手那张卡缩到多大。跟手时要按它算「往下让半张卡」。 */
  ghostScale: number
  /** 触屏那一档要走「滚动优先」的判定（见 dragRules 的 scrollGuard）。 */
  scrollGuard: boolean
}

export interface DeckInput {
  pressAt(x: number, y: number, pointerType?: string): void
  moveTo(x: number, y: number): void
  releaseAt(x: number, y: number): void
  /** 还在跟手吗。帧循环靠它决定停不停（3.6）。 */
  isBusy(): boolean
  /** 拆掉：把跟手那张卡还回回收池。 */
  destroy(): void
}

export function createDeckInput(ctx: DeckContext): DeckInput {
  let press: Press | null = null

  /**
   * 牌组栏现在够不够得着。
   *
   * 手机档抽屉收起来时整层挪到了屏幕底下（见 layout/mobileLayout.ts），
   * 那时候卡位的坐标还在，但屏幕上根本看不见——不挡一下的话，
   * 指针在卡池下半截一划就会「抓到」一张看不见的牌。
   */
  const slotsReachable = (): boolean => ctx.layout.drawer === null || ctx.state.drawerOpen

  /** 指针底下压着哪张卡（先看牌组栏，再看卡池——牌组栏在手机档是浮在卡池上的抽屉）。 */
  const cardUnder = (x: number, y: number): Press['origin'] | null => {
    const point = { x, y }
    if (slotsReachable() && insideGrid(ctx.layout.slots, point)) {
      const deck = shownDeck(ctx)
      const hit = nearestCell(ctx.layout.slots, point, deck.length)
      const cardId = hit === null ? undefined : deck[hit.index]
      if (hit !== null && cardId !== undefined) {
        return { from: 'deck', cardId, index: hit.index }
      }
      return null
    }
    if (insideGrid(ctx.layout.poolGrid, point)) {
      const shown = visiblePool(ctx)
      const hit = nearestCell(ctx.layout.poolGrid, point, shown.length)
      const entry = hit === null ? undefined : shown[hit.index]
      if (hit !== null && entry !== undefined) {
        return { from: 'pool', cardId: entry.cardId, index: hit.index }
      }
    }
    return null
  }

  /** 起拖：建一张跟手的卡，原位空出来。 */
  const beginDrag = (state: Press, x: number, y: number): void => {
    state.dragging = true
    ctx.dragging = state.origin
    const ghost = ctx.holdCard(state.origin.cardId, `drag:${state.origin.cardId}`)
    state.ghostScale = dragScaleOf(state.origin.from) * DRAG_SCALE
    ghost.scale.set(state.ghostScale)
    ctx.parts.layers.drag.addChild(ghost)
    state.ghost = ghost
    follow(state, x, y)
    renderDeckScene(ctx)
  }

  /** 跟手那张卡在哪档缩放上。卡池那张本来就画得大，拖起来不该突然缩成卡位那么小。 */
  const dragScaleOf = (from: 'pool' | 'deck'): number =>
    from === 'pool' ? ctx.layout.poolCardScale : ctx.layout.slotCardScale

  /**
   * 让跟手那张卡贴着指针。
   *
   * 卡的原点在**底边中点**（见 CardSprite 的坐标约定），所以要往下让半张卡高，
   * 卡心才落在指针上。半张卡的高按**基准尺寸乘缩放**算，不问包围盒——
   * 包围盒在倾斜和翻面期间每帧都在变，拿它算落点会让卡在拖的过程中飘。
   */
  const follow = (state: Press, x: number, y: number): void => {
    const ghost = state.ghost
    if (ghost === null) return
    ghost.position.set(x, y + (CARD_HEIGHT * state.ghostScale) / 2)
    ctx.wake()
  }

  /** 收掉跟手那张卡，恢复「没在拖」。 */
  const endDrag = (state: Press): void => {
    if (state.ghost !== null) ctx.releaseCard(state.ghost, state.origin.cardId)
    state.ghost = null
    ctx.dragging = null
    ctx.gap = null
  }

  /** 真的把一张牌加进牌组。加不进去的时候一个字都不改，界面上那句话由提示条说。 */
  const commitAdd = (cardId: CardId, at: number): boolean => {
    const entry = ctx.pool.find((one) => one.cardId === cardId)
    const blocked = addBlockReason({
      deck: currentCards(ctx.state),
      cardId,
      rules: ctx.rules,
      blockedReason: entry?.blockedReason ?? null,
    })
    if (blocked !== null) return false
    ctx.state = addCard(ctx.state, cardId, at)
    ctx.emitChange()
    return true
  }

  return {
    pressAt(x, y, pointerType = 'mouse') {
      const origin = cardUnder(x, y)
      if (origin === null) return
      press = {
        fromX: x,
        fromY: y,
        origin,
        dragging: false,
        moved: 0,
        ghost: null,
        ghostScale: 1,
        /*
         * 卡池是一块能翻页的网格，触屏上手指落点几乎必然压在某张卡上，
         * 所以那一档走「滚动优先」的判定（见 dragRules 的 scrollGuard）。
         * 鼠标不受影响：`dragGestureOf` 只在 scrollGuard 为真时才分方向。
         */
        scrollGuard: pointerType !== 'mouse',
      }
    },

    moveTo(x, y) {
      const state = press
      if (state === null) return
      const dx = x - state.fromX
      const dy = y - state.fromY
      state.moved = Math.max(state.moved, Math.hypot(dx, dy))
      if (!state.dragging) {
        const gesture = dragGestureOf({ dx, dy, scrollGuard: state.scrollGuard })
        // 判成滚动：这次按下整个作废（手指是在翻页，不是要抓牌）。
        if (gesture === 'scroll') {
          press = null
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
        state.origin.from === 'pool' && slotsReachable() && insideGrid(ctx.layout.slots, { x, y })
          ? insertIndexAt({
              grid: ctx.layout.slots,
              deckLength: currentCards(ctx.state).length,
              gap: ctx.gap,
              point: { x, y },
            })
          : null
      if (gap === ctx.gap) return
      ctx.gap = gap
      renderDeckScene(ctx)
    },

    releaseAt(x, y) {
      const state = press
      press = null
      if (state === null) return

      if (!state.dragging) {
        /*
         * 没起拖 = 点了一下 = 放大查看。
         * 触屏上「斜着划了一大段、两条阈值都没过」不该算点击，所以那一档要再看一眼位移。
         */
        const tapped = !state.scrollGuard || state.moved <= TOUCH_HOLD_TOLERANCE
        if (tapped) ctx.emitInspect(state.origin.cardId)
        return
      }

      const inside = slotsReachable() && insideGrid(ctx.layout.slots, { x, y })
      const gap = ctx.gap
      endDrag(state)

      if (state.origin.from === 'pool') {
        // 落在牌组栏里才是加牌；落点用让位那一格（它就是玩家瞄着的地方）。
        if (inside) {
          const at =
            gap ??
            insertIndexAt({
              grid: ctx.layout.slots,
              deckLength: currentCards(ctx.state).length,
              gap: null,
              point: { x, y },
            })
          commitAdd(state.origin.cardId, at)
        }
      } else if (!inside) {
        // 从牌组里拖出来、松手落在栏外：这是移除。落在栏里就是什么都没发生（不换位置）。
        ctx.state = removeAt(ctx.state, state.origin.index)
        ctx.emitChange()
      }
      renderDeckScene(ctx)
    },

    isBusy: () => press?.dragging === true,

    destroy() {
      if (press !== null) endDrag(press)
      press = null
    },
  }
}

/** 点卡池第 index 格的「＋」：按当前这一页的第一格插进去。落点口径见 logic/pagination.ts。 */
export function addFromPool(ctx: DeckContext, index: number, at: number): boolean {
  const entry = visiblePool(ctx)[index]
  if (entry === undefined) return false
  const blocked = addBlockReason({
    deck: currentCards(ctx.state),
    cardId: entry.cardId,
    rules: ctx.rules,
    blockedReason: entry.blockedReason,
  })
  if (blocked !== null) return false
  ctx.state = addCard(ctx.state, entry.cardId, at)
  ctx.emitChange()
  renderDeckScene(ctx)
  return true
}
