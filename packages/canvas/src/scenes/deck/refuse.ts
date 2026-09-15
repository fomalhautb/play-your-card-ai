/**
 * 「这张牌加不进去」的反馈：卡摇个头，卡顶弹一句为什么，一会儿自己收掉。
 *
 * 从前这一下只是把卡池底边那条提示换一句话——那条在屏幕另一头，玩家正盯着自己拖的那张牌，
 * 十有八九看不见，于是界面看起来像「点了没反应」。黑客松那边是摇头加浮字，这里照它补回来。
 *
 * 三处都走这一条（拖进去被拒、点「＋」被拒、放大层那颗钮被拒），所以那句话**只有一份**
 *（`logic/legality.ts` 的 `addBlockReason`）——各判各的迟早会出现「这儿说满了、那儿说带不了这么多份」。
 *
 * 浮字走一块**长住**的 `Box`（藏在拖拽层里），每次只改它的字和位置：
 * 随建随销的话每次被拒都要新烤一张纹理，而被拒是连着点「＋」时最容易反复触发的一下。
 * 停留计时**不用 `setTimeout`**：这一页的时间由帧循环推（手动时钟下没有真实时间源，3.6），
 * 用挂钟计时会让目录页和 bench 里的画面停在半路。改成一条带 delay 的补间，账和别处同一本。
 */

import type { CardId } from '@ai-duel/core'
import type { Box } from '../../components/Box'
import type { CardSprite } from '../../components/CardSprite'
import { CARD_HEIGHT } from '../../layout/fanMath'
import { poolCardOf } from './anchors'
import type { DeckContext } from './context'
import { shakeCard } from './dragFx'
import { addBlockReason } from './logic/legality'
import { currentCards } from './state'
import { ADD_TIP_GAP, ADD_TIP_HOLD_MS, ADD_TIP_IN, ADD_TIP_OUT } from './timings'

export interface RefuseOptions {
  /** 取当前上下文。它是场景装好之后才有的，所以走取值器。 */
  ctx(): DeckContext
  /** 那块长住的浮字。换一套零件会换掉它，同样走取值器。 */
  tip(): Box
}

export interface Refuse {
  /**
   * 演一遍。加得进去（`addBlockReason` 给 null）就什么都不做。
   *
   * @param card 摇哪张卡。给 null 就去卡池里找那一格——点「＋」那条没有跟手的卡；
   *   找不到（那张牌滚出视野了）就只摇不到、也不弹字。
   */
  show(cardId: CardId, card: CardSprite | null): void
}

export function createRefuse(options: RefuseOptions): Refuse {
  return {
    show(cardId, card) {
      const ctx = options.ctx()
      const reason = addBlockReason({
        deck: currentCards(ctx.state),
        cardId,
        rules: ctx.rules,
        blockedReason: ctx.pool.find((one) => one.cardId === cardId)?.blockedReason ?? null,
      })
      if (reason === null) return
      const target = card ?? poolCardOf(ctx, cardId)
      if (target === null) return
      shakeCard(ctx.animator, target)
      showTip(ctx, options.tip(), reason, target)
      ctx.wake()
    },
  }
}

/** 在这张卡的上方弹一句话。 */
function showTip(ctx: DeckContext, tip: Box, reason: string, card: CardSprite): void {
  tip.setLabel(reason)
  /*
   * 停在卡顶上方：卡的原点在**底边中点**，卡心在它上面半张卡处，再往上让一口气和浮字自己的高。
   * 卡的高按**基准尺寸乘缩放**算，不问包围盒——包围盒在倾斜和摇头期间每帧都在变。
   */
  const center = ctx.stage.toLocal(card.getGlobalPosition())
  const top = center.y - CARD_HEIGHT * card.scale.y
  tip.position.set(center.x - tip.boxWidth / 2, top - ADD_TIP_GAP - tip.boxHeight)
  tip.visible = true
  const { animator } = ctx
  // 连着被拒时重新计时，免得它刚弹出来就被上一次的计时收走。
  animator.killTweensOf(tip)
  animator.fromTo(
    tip,
    { alpha: 0 },
    { alpha: 1, duration: ADD_TIP_IN, ease: 'power2.out', overwrite: 'auto' },
  )
  animator.tween(tip, {
    alpha: 0,
    duration: ADD_TIP_OUT,
    delay: ADD_TIP_IN + ADD_TIP_HOLD_MS / 1000,
    ease: 'none',
    onComplete: () => {
      tip.visible = false
    },
  })
}
