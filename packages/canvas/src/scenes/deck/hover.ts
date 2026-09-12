/**
 * 指针停在一张卡上时的三件事：格子亮一圈、卡跟着指针倾斜、点右上角的问号章翻面。
 *
 * 不给每个格子挂 `pointerover`，而是拿**一份指针坐标自己算**指针压在哪一格上：
 * 这一页的卡是借来摆的（滚动、加牌、删牌都在换），格子和卡的对应关系每一轮都可能变，
 * 挂在对象上的监听就得跟着搬。算的那一套和 input.ts 抓牌用的是同一条判定（见 hit.ts），
 * 所以「亮的那一格」和「抓到的那一张」永远是同一个。
 *
 * 倾斜的物理模型共用 `CardTilt`（和对局的手牌、战场小卡同一份），只是最大角度按位置分三档
 *（见 timings.ts 的 POOL_TILT_DEG / MINI_TILT_DEG）。它要逐帧收敛，所以这里也要叫醒帧循环。
 */

import { Point as PixiPoint } from 'pixi.js'
import type { CardSprite } from '../../components/CardSprite'
import { hitsSeal } from '../../components/cardFaceParts'
import { CardTilt } from '../../components/cardTilt'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import { cellRect, type GridSpec } from '../../layout/gridMath'
import type { DeckContext } from './context'
import { cellAt, insideArea, type Point } from './hit'
import { filteredPool } from './render'
import { HELP_FLIP_DUR, MINI_TILT_DEG, POOL_TILT_DEG } from './timings'

/** 指针此刻压在哪儿。 */
interface Spot {
  where: 'pool' | 'deck'
  /** 卡池那一档是筛完之后的序号，牌组那一档是格子序号。 */
  index: number
  card: CardSprite
  /** 卡自己坐标里的指针位置（原点在底边中点）。 */
  local: Point
}

export interface DeckHover {
  /** 指针动了（舞台坐标）。 */
  move(x: number, y: number): void
  /**
   * 按下了一下：落在问号章上就把这一下吃掉，返回有没有吃。
   *
   * 吃掉是为了别让「点问号」变成「放大查看」或者「抓起这张牌」。
   * 翻面本身不在这里做——它跟着**指针进出热区**走（同黑客松），见 `move`。
   */
  tap(x: number, y: number): boolean
  /** 逐帧推倾斜的收敛，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
  /** 收手：起拖、放大查看、换一套零件时都要收。 */
  release(): void
}

export function createDeckHover(ctx: DeckContext): DeckHover {
  /** 每张卡各一份倾斜跟随。卡是回收复用的，所以这张表跟着卡走，不跟着格子走。 */
  const tilts = new Map<CardSprite, CardTilt>()
  let hovered: { where: 'pool' | 'deck'; index: number; card: CardSprite } | null = null
  /** 换算指针坐标用的草稿。复用同一块，逐次指针移动不产生堆分配（3.10）。 */
  const scratch = new PixiPoint()

  const tiltOf = (card: CardSprite, maxDeg: number): CardTilt => {
    const kept = tilts.get(card)
    if (kept !== undefined) return kept
    const made = new CardTilt(card, ctx.cardTilt, maxDeg)
    tilts.set(card, made)
    return made
  }

  /** 这块网格里指针**真的落在**哪一格上（落在格与格之间的空隙里不算）。 */
  const cellUnder = (
    grid: GridSpec,
    view: { x: number; y: number; width: number; height: number } | null,
    point: Point,
    count: number,
    offset: number,
  ): number | null => {
    if (!insideArea(grid, view, point)) return null
    const hit = cellAt(grid, point, count, offset)
    if (hit === null) return null
    const rect = cellRect(grid, hit.index)
    const y = point.y + offset
    const inside =
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    return inside ? hit.index : null
  }

  /** 指针压在哪张卡上，以及指针在那张卡自己坐标里的位置。 */
  const spotAt = (x: number, y: number): Spot | null => {
    const point = { x, y }
    const slotsOpen = ctx.layout.drawer === null || ctx.state.drawerOpen
    if (slotsOpen) {
      const shown = ctx.parts.slots
      const index = cellUnder(
        ctx.layout.slots,
        ctx.layout.slotScroll?.view ?? null,
        point,
        ctx.rules.size,
        ctx.slotScroll.offset,
      )
      const card = index === null ? null : shown.cardAt(index)
      if (index !== null && card !== null) {
        return { where: 'deck', index, card, local: localIn(card, point) }
      }
      if (index !== null) return null
    }
    const poolOpen = ctx.layout.drawer === null || !ctx.state.drawerOpen
    if (!poolOpen) return null
    const cells = ctx.parts.poolCells
    const index = cellUnder(
      ctx.layout.poolGrid,
      ctx.layout.poolScroll?.view ?? null,
      point,
      filteredPool(ctx).length,
      ctx.poolScroll.offset,
    )
    if (index === null) return null
    const cell = cells.find((one) => one.poolIndex === index)
    const card = cell?.shown ?? null
    if (card === null) return null
    return { where: 'pool', index, card, local: localIn(card, point) }
  }

  /**
   * 把舞台坐标换算成卡自己的坐标（原点在底边中点，卡面占 x ∈ [−75,75]、y ∈ [−225,0]）。
   *
   * 走 Pixi 的 `toLocal` 而不是自己减坐标：卡挂在格子里、格子挂在滚动层里，
   * 中间隔着好几层位移和缩放，自己算就得把那几层全抄一遍。
   */
  const localIn = (card: CardSprite, point: Point): Point => {
    scratch.set(point.x, point.y)
    return card.toLocal(scratch, ctx.stage, scratch)
  }

  const leave = (): void => {
    const before = hovered
    if (before === null) return
    hovered = null
    if (before.where === 'pool') {
      ctx.parts.poolCells.find((one) => one.poolIndex === before.index)?.setHovered(false)
    }
    tilts.get(before.card)?.release()
    // 离开就翻回正面：翻着的那一面是「指针停在问号上」的状态，手一走就该收。
    flipTo(before.card, 0)
    ctx.wake()
  }

  const flipTo = (card: CardSprite, angle: number): void => {
    if (card.flipState.angle === angle) return
    ctx.animator.tween(card.flipState, {
      angle,
      duration: HELP_FLIP_DUR,
      ease: 'power2.inOut',
      overwrite: 'auto',
      onUpdate: () => card.setFlipAngle(card.flipState.angle),
    })
    ctx.wake()
  }

  return {
    move(x, y) {
      const spot = spotAt(x, y)
      if (spot === null) {
        leave()
        return
      }
      if (hovered === null || hovered.card !== spot.card) {
        leave()
        hovered = { where: spot.where, index: spot.index, card: spot.card }
        if (spot.where === 'pool') {
          ctx.parts.poolCells.find((one) => one.poolIndex === spot.index)?.setHovered(true)
        }
      }
      const maxDeg = spot.where === 'pool' ? POOL_TILT_DEG : MINI_TILT_DEG
      tiltOf(spot.card, maxDeg).setPointer(
        spot.local.x / CARD_WIDTH + 0.5,
        spot.local.y / CARD_HEIGHT + 1,
      )
      /*
       * 翻面跟着**指针进出问号热区**走（同黑客松：`指针进出问号热区时各翻一次`）。
       * 热区和画出来的那枚章是同一份几何（`hitsSeal`），两边对不上玩家就会点在章上没反应。
       */
      if (spot.card.flippable) {
        flipTo(spot.card, hitsSeal(spot.local.x, spot.local.y) ? 180 : 0)
      }
      ctx.wake()
    },

    tap(x, y) {
      const spot = spotAt(x, y)
      if (spot === null || !spot.card.flippable) return false
      return hitsSeal(spot.local.x, spot.local.y)
    },

    advance(deltaMs) {
      let busy = false
      for (const tilt of tilts.values()) if (tilt.advance(deltaMs)) busy = true
      return busy
    },

    release() {
      leave()
      for (const tilt of tilts.values()) tilt.reset()
    },
  }
}
