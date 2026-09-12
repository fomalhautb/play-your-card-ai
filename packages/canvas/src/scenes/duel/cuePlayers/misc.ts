/**
 * 剩下那五种：演出锁的上/放、催一催的喊话气泡、指令被拒的红字、教程要等的舞台信号。
 *
 * 它们的共同点是**不产生动画**（`durationMs` 都是 0，气泡那条除外），
 * 只是把某个状态切一下、或者把一条信号转给场景外面。
 */

import { tokens } from '@ai-duel/design'
import { BUBBLE_ERROR, BUBBLE_SHOUT, Bubble } from '../../../components/Bubble'
import type { DuelContext } from '../context'
import type { CuePlayerGroup } from './types'

/** 气泡挂多久（毫秒）。`urge` 的时长由 cue 给，被拒那条 cue 记 0，用这个兜底。 */
const BUBBLE_HOLD_MS = Math.round(tokens.duration.bubble.hold * 1000)

/** 气泡一行最多多宽。超了组件自己把整块缩小。 */
const BUBBLE_MAX_WIDTH = 320

/**
 * 弹一个气泡，挂够时间自己收。
 *
 * 同一时刻只留一个：两条提示叠在同一个位置谁也读不清，而后来的那条总是更要紧的。
 */
function popBubble(
  ctx: DuelContext,
  variant: typeof BUBBLE_SHOUT | typeof BUBBLE_ERROR,
  content: string,
  holdMs: number,
): void {
  const layer = ctx.parts.layers.bubble
  for (const child of layer.removeChildren()) {
    // 上一颗可能还在淡入淡出，掐干净再拆——它的补间挂在私有的内层上，只有组件自己掐得到。
    if (child instanceof Bubble) child.clear()
    child.destroy({ children: true })
  }
  const bubble = new Bubble({ variant, content, maxWidth: BUBBLE_MAX_WIDTH }, ctx.deps)
  bubble.position.set(
    ctx.layout.bubble.x - bubble.boxWidth / 2,
    ctx.layout.bubble.y - bubble.boxHeight / 2,
  )
  layer.addChild(bubble)
  bubble.show()
  ctx.after(holdMs, () => {
    bubble.hide()
    ctx.after(Math.round(tokens.duration.bubble.out * 1000), () => {
      bubble.clear()
      bubble.destroy({ children: true })
    })
  })
}

type MiscKind = 'lock-acquire' | 'lock-release' | 'urge' | 'error' | 'tutorial'

export const miscPlayers: CuePlayerGroup<MiscKind> = {
  /**
   * 上一把演出锁：手牌整个冻住、按钮也按不动，直到同编号的 `lock-release`。
   *
   * 按编号记而不是记一个布尔：兜底先到点放了锁、玩家又打出下一张牌时，
   * 迟到的那条收尾放掉的会是别人的锁（编排层那边同一个理由，见 director/locks.ts）。
   */
  'lock-acquire'(ctx, cue) {
    ctx.locks.add(cue.token)
    ctx.refreshLocks()
  },

  'lock-release'(ctx, cue) {
    ctx.locks.delete(cue.token)
    ctx.refreshLocks()
  },

  /** 「催一催」的喊话。本端点的和对面发来的走同一条路，两台机器上弹的是同一句。 */
  urge(ctx, cue) {
    popBubble(ctx, BUBBLE_SHOUT, cue.lineId, cue.durationMs > 0 ? cue.durationMs : BUBBLE_HOLD_MS)
  },

  /**
   * 指令被拒的红字。
   *
   * cue 的 `durationMs` 是 0——旧版这句话是常驻文案，跟着 `lastRejection` 挂到下一条指令
   * 有结果为止。画布上没有「常驻到下一次状态变化」这种东西，所以改成挂够一段固定时间，
   * 期间又被拒一次就当场换成新的那句（popBubble 只留一个）。
   */
  error(ctx, cue) {
    popBubble(ctx, BUBBLE_ERROR, cue.reason, BUBBLE_HOLD_MS)
  },

  /** 教程要等的舞台信号，原样转给外面。教程状态机本身还没迁（第 32 条）。 */
  tutorial(ctx, cue) {
    ctx.tutorial(cue.cue)
  },
}
