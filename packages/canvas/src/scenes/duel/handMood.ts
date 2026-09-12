/**
 * 手牌的「现在能不能动」长什么样：整排的灰墨态、逐张的压暗和光标、点上去弹的那句小字。
 *
 * 编排层早就把判断做完了（`DirectorLocks.handLockReason` / `handFrozen`，见 director.ts），
 * 只是一直没人消费；这个文件就是那一份的消费者。它只改外观，不挡任何操作——
 * 「许不许动」归 `input.ts` 的 `canAct`，两件事分开才不会出现「看着能点、点了没反应」。
 *
 * 压暗用 tint 不用 Filter（3.1）：黑客松那边整排是 `saturate(.5) brightness(.9)`、
 * 打不出的那几张是 `grayscale(.6) brightness(.72)`，tint 只能压暗、去不掉饱和度，
 * 所以颜色上比旧版艳一点。要表达的那件事（这排现在不归你动 / 这张买不起）没丢。
 *
 * 小字提示预先建好放着，不在点下去那一刻建：建一句字就要烤一张纹理，
 * 而这一下多半发生在演出途中，6.9 的「动画期间文字对象重建 = 0」不许那么干。
 */

import { effectivePlayCost, type HandCard } from '@ai-duel/core'
import { Box } from '../../components/Box'
import type { CardSprite } from '../../components/CardSprite'
import type { DirectorLocks, HandLockReason } from '../../director/director'
import { CARD_HEIGHT } from '../../layout/fanMath'
import type { DuelContext } from './context'
import { fanToWorld } from './layout/types'

/**
 * 整排压暗到哪一档，以及买不起的那几张再深一档。
 *
 * 两个数是照黑客松那两条滤镜的亮度调出来的（`brightness(.9)` 和 `brightness(.72)`，
 * 再各压一点补上去不掉的那点饱和度）。
 */
const DIM = { locked: 0x999999, unplayable: 0x7a7a7a } as const

/** 小字提示浮在牌顶上方多少像素（舞台坐标）。抄黑客松的 `LOCK_TIP_GAP`。 */
const TIP_GAP = 10
/** 小字自己停留多久（毫秒）再淡出。够读完四个字，又不至于一直挂在屏幕上。 */
const TIP_HOLD_MS = 1100
/** 小字淡入淡出各多久（秒）。 */
const TIP_FADE = { in: 0.18, out: 0.25 } as const
/** 小字那块方块多大。四句话最长五个字，12 号字下 100 宽装得开。 */
const TIP_BOX = { width: 100, height: 24 } as const

/** 「这排现在为什么动不了」各自的文案。抄黑客松 `HandFan.tsx` 的 `LOCK_TIP_TEXT`。 */
const LOCK_TIP: Record<HandLockReason, string> = {
  'foe-turn': '对方出牌中',
  quiz: 'AI 答题中',
  deal: '发牌中…',
}
/** 这一轮剩下的 Token 买不起这张牌时弹的那句。 */
const COST_TIP = 'Token 不够'

/** 一张牌现在为什么打不出：整排锁着（哪一种），还是单独这张买不起。 */
type Block = HandLockReason | 'cost'

export interface HandMood {
  /** 锁、局面或者 hover 变了：整排重新定灰墨态，逐张重新定压暗和光标。 */
  refresh(locks: DirectorLocks | null): void
  /** 点了一张此刻打不出的牌：在它头顶弹一句小字。返回有没有弹（没弹就说明这张能打）。 */
  popTip(card: CardSprite): boolean
  destroy(): void
}

export function createHandMood(ctx: DuelContext): HandMood {
  let locks: DirectorLocks | null = null
  /** 四句话各建一块，用哪句就亮哪块。键就是文案本身。 */
  const tips = new Map<string, Box>()
  for (const label of [...Object.values(LOCK_TIP), COST_TIP]) {
    const box = new Box({ ...TIP_BOX, label, size: 'small' }, ctx.deps)
    box.eventMode = 'none'
    box.visible = false
    box.alpha = 0
    ctx.parts.layers.bubble.addChild(box)
    tips.set(label, box)
  }

  /** 这张牌是哪张牌面。查不到（目录和牌组对不上）就当它没有费用限制。 */
  const cardOf = (card: CardSprite): HandCard | null => {
    const cardId = ctx.handCardIds.get(card.instanceId)
    if (cardId === undefined) return null
    return ctx.view?.catalog.cards[cardId] ?? null
  }

  const blockOf = (card: CardSprite): Block | null => {
    const reason = locks?.handLockReason ?? null
    if (reason !== null) return reason
    const definition = cardOf(card)
    const self = ctx.view?.self
    if (definition === null || self === undefined) return null
    return effectivePlayCost(self, definition) > self.tokens ? 'cost' : null
  }

  return {
    refresh(next) {
      locks = next
      const { fan } = ctx.parts
      // 整排下沉只看「这一排锁着没有」，和某一张买不买得起无关。
      fan.setSunk(locks?.handLockReason != null)
      const laid = fan.laid()
      const hovered = fan.hovered >= 0 ? laid[fan.hovered] : undefined
      for (const card of fan.all()) {
        const block = blockOf(card)
        // 抬起来的那张恢复本色：玩家正在看它，压暗的是"够不着的那一片"，不是他手里这张。
        card.setDim(block === null || card === hovered ? 0xffffff : dimOf(block))
        card.cursor = block === 'cost' ? 'not-allowed' : 'pointer'
      }
    },

    popTip(card) {
      const block = blockOf(card)
      if (block === null) return false
      const box = tips.get(block === 'cost' ? COST_TIP : LOCK_TIP[block])
      if (box === undefined) return false
      place(ctx, box, card)
      const { animator } = ctx.deps
      animator.killTweensOf(box)
      box.visible = true
      box.alpha = 0
      const line = animator.timeline({ onComplete: () => (box.visible = false) })
      line.to(box, { alpha: 1, duration: TIP_FADE.in })
      line.to(box, { alpha: 0, duration: TIP_FADE.out, delay: TIP_HOLD_MS / 1000 })
      ctx.wake()
      return true
    },

    destroy() {
      for (const box of tips.values()) {
        ctx.deps.animator.killTweensOf(box)
        box.destroy({ children: true })
      }
      tips.clear()
    },
  }
}

function dimOf(block: Block): number {
  return block === 'cost' ? DIM.unplayable : DIM.locked
}

/**
 * 把小字摆到这张牌的正上方（舞台坐标）。
 *
 * 牌在扇形自己的坐标系里，而提示挂在气泡层（那一层直接贴着舞台），所以要换算一次。
 * 整排沉下去时 `pivot` 被写过（见 HandFan 的 setSunk），换算里要把它一起算进去，
 * 否则灰墨态下提示会浮在离牌 12 像素远的地方。
 */
function place(ctx: DuelContext, box: Box, card: CardSprite): void {
  const { fan } = ctx.parts
  const scale = card.scale.x
  const top = card.y - CARD_HEIGHT * scale - fan.pivot.y
  const world = fanToWorld(ctx.layout, card.x, top, scale)
  box.position.set(world.x - box.boxWidth / 2, world.y - TIP_GAP - box.boxHeight)
}
