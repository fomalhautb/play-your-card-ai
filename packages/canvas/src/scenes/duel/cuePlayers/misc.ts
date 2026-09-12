/**
 * 剩下那三种：演出锁的上 / 放、指令被拒的红字。
 *
 * 它们的共同点是**不产生动画**（`durationMs` 都是 0），只是把某个状态切一下。
 *
 * 正式版简化第 4 步之二把那条提示剥成素方块（见 components/Box.ts）：从前是 `Bubble` 的
 * 「错误红字」变体，现在是一块描边方块。淡入淡出仍然走场景的 Animator，
 * 只有它建的补间会被帧循环记账（3.6）。
 */

import { tokens } from '@ai-duel/design'
import { Box } from '../../../components/Box'
import type { DuelContext } from '../context'
import type { CuePlayerGroup } from './types'

/** 提示挂多久（毫秒）。被拒那条 cue 的 `durationMs` 记 0，挂多久由这里定。 */
const BUBBLE_HOLD_MS = Math.round(tokens.duration.bubble.hold * 1000)

/** 提示那一格多大。宽按引擎最长的那句拒绝理由留，超了方块自己把字缩小。 */
const BUBBLE_BOX = { width: 320, height: 32 } as const

/**
 * 弹一条提示，挂够时间自己收。
 *
 * 同一时刻只留一个：两条提示叠在同一个位置谁也读不清，而后来的那条总是更要紧的。
 */
function popBubble(ctx: DuelContext, content: string, holdMs: number): void {
  const layer = ctx.parts.layers.bubble
  for (const child of layer.removeChildren()) {
    // 上一条可能还在淡入淡出，掐干净再拆，否则 GSAP 下一帧会写到已经销毁的对象上。
    ctx.deps.animator.killTweensOf(child)
    child.destroy({ children: true })
  }
  const bubble = new Box(
    { width: BUBBLE_BOX.width, height: BUBBLE_BOX.height, label: content, size: 'small' },
    ctx.deps,
  )
  bubble.position.set(
    ctx.layout.bubble.x - BUBBLE_BOX.width / 2,
    ctx.layout.bubble.y - BUBBLE_BOX.height / 2,
  )
  layer.addChild(bubble)
  ctx.deps.animator.fromTo(
    bubble,
    { alpha: 0 },
    { alpha: 1, duration: tokens.duration.bubble.in, ease: 'power2.out', overwrite: true },
  )
  ctx.after(holdMs, () => {
    ctx.deps.animator.tween(bubble, {
      alpha: 0,
      duration: tokens.duration.bubble.out,
      overwrite: true,
    })
    ctx.after(Math.round(tokens.duration.bubble.out * 1000), () => {
      ctx.deps.animator.killTweensOf(bubble)
      bubble.destroy({ children: true })
    })
  })
}

type MiscKind = 'lock-acquire' | 'lock-release' | 'error'

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

  /**
   * 指令被拒的红字。
   *
   * cue 的 `durationMs` 是 0——旧版这句话是常驻文案，跟着 `lastRejection` 挂到下一条指令
   * 有结果为止。画布上没有「常驻到下一次状态变化」这种东西，所以改成挂够一段固定时间，
   * 期间又被拒一次就当场换成新的那句（popBubble 只留一个）。
   */
  error(ctx, cue) {
    popBubble(ctx, cue.reason, BUBBLE_HOLD_MS)
  },
}
