/**
 * 战场小卡的 hover：抬一点点（`TILE_HOVER_SCALE`）并跟着指针倾斜。
 *
 * 和手牌那套（`interaction/handPointer.ts`）分开写，因为两边要做的事几乎不重叠：
 * 手牌要管按下、阈值、拖拽、落点判定、整排让位，而格子上只有「指针进来了没有」这一件事。
 * 共用的只有 `CardTilt`——倾斜的物理模型两边是同一份。
 *
 * 倾斜跟随要逐帧推进，所以这里也要自己叫醒帧循环（同 handPointer 的文件头）。
 */

import { Point } from 'pixi.js'
import type { BoardTile } from '../../components/BoardTile'
import type { CardSprite } from '../../components/CardSprite'
import { CardTilt } from '../../components/cardTilt'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import type { DuelContext } from './context'

/**
 * 指针停在一张战场小卡上时它放大到多少。抄黑客松 `MatchStage.tsx` 的 `TILE_HOVER_SCALE`。
 *
 * 只有 1.05：格子是紧挨着排的，再大就会压住邻居；这一下要说的只是「指针在这张上」，
 * 看清楚那张牌是点开放大查看的事。
 */
const TILE_HOVER_SCALE = 1.05
/** 抬起和落回的时长（秒），和手牌 hover 同一档节奏。 */
const HOVER_DUR = 0.18

export interface TileHover {
  /** 给一个新建的格子挂上进出监听。 */
  bind(tile: BoardTile): void
  /** 指针动了（舞台坐标）：喂给此刻停着的那张小卡。 */
  move(stageX: number, stageY: number): void
  /** 逐帧推进倾斜的收敛，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
  /** 收手：选目标开始、演出锁上、格子被展示层借走时都要收。 */
  release(): void
  destroy(): void
}

export function createTileHover(ctx: DuelContext, enabled: () => boolean): TileHover {
  /** 每个格子各存一个倾斜跟随。格子换卡（进化、英雄技能）时跟着换，见 tiltOf。 */
  const tilts = new Map<BoardTile, { card: CardSprite; tilt: CardTilt }>()
  let hovered: BoardTile | null = null
  /** 换算指针坐标用的草稿。复用同一块，逐次指针移动不产生堆分配（3.10）。 */
  const scratch = new Point()

  /** 这个格子现在那张卡的倾斜跟随。卡换过就重建一个——旧的那份指着已经销毁的卡。 */
  const tiltOf = (tile: BoardTile): CardTilt => {
    const kept = tilts.get(tile)
    if (kept !== undefined && kept.card === tile.sprite) return kept.tilt
    const made = { card: tile.sprite, tilt: new CardTilt(tile.sprite, ctx.deps.cardTilt) }
    tilts.set(tile, made)
    return made.tilt
  }

  const leave = (tile: BoardTile): void => {
    if (hovered !== tile) return
    hovered = null
    tiltOf(tile).release()
    ctx.deps.animator.tween(tile.sprite.scale, {
      x: tile.cardScale,
      y: tile.cardScale,
      duration: HOVER_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })
    ctx.wake()
  }

  return {
    bind(tile) {
      tile.on('pointerover', () => {
        if (!enabled() || hovered === tile) return
        if (hovered !== null) leave(hovered)
        hovered = tile
        ctx.deps.animator.tween(tile.sprite.scale, {
          x: tile.cardScale * TILE_HOVER_SCALE,
          y: tile.cardScale * TILE_HOVER_SCALE,
          duration: HOVER_DUR,
          ease: 'power2.out',
          overwrite: 'auto',
        })
        ctx.wake()
      })
      tile.on('pointerout', () => leave(tile))
    },

    move(stageX, stageY) {
      const tile = hovered
      if (tile === null) return
      const card = tile.sprite
      scratch.set(stageX, stageY)
      const local = card.toLocal(scratch, ctx.stage, scratch)
      // 卡面在自己的坐标里占 x ∈ [−75, 75]、y ∈ [−225, 0]（原点在底边中点）。
      tiltOf(tile).setPointer(local.x / CARD_WIDTH + 0.5, local.y / CARD_HEIGHT + 1)
      ctx.wake()
    },

    advance(deltaMs) {
      let busy = false
      for (const { tilt } of tilts.values()) if (tilt.advance(deltaMs)) busy = true
      return busy
    },

    release() {
      if (hovered !== null) leave(hovered)
      for (const { tilt } of tilts.values()) tilt.release()
    },

    destroy() {
      // 卡不归这里销毁（格子自己管），倾斜跟随本身没有要收的资源，清表即可。
      tilts.clear()
      hovered = null
    },
  }
}
