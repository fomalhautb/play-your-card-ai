/**
 * 构筑页的放大查看：点一张卡，它飞到屏幕中央放大，点遮罩关掉。
 *
 * 从 DeckScene.ts 里拎出来的一小块状态（400 行那条上限逼的，见架构 7.2 第 3 条）。
 * 它只认三样东西：展示层那个零件、卡的回收池、以及「叫醒帧循环」这一下，
 * 所以换一套零件、换一档版式都不用动它。
 *
 * 卡从**回收池**借出来而不是现建：这一页的卡随时在借还（翻页、加牌、删牌都要重排），
 * 放大的那一张走同一条路，关掉时直接还回去即可（见 cards.ts）。
 */

import type { CardId } from '@ai-duel/core'
import type { CardSprite } from '../../components/CardSprite'
import type { CardPool } from './cards'
import type { DeckParts } from './parts'

export interface DeckInspect {
  /** 现在开着没有。开着的时候整页不接拖拽——展示层铺满全屏，底下那些卡本来就点不着。 */
  readonly open: boolean
  /** 点开一张卡。已经开着就什么都不做（同一时刻只放大一张）。 */
  show(cardId: CardId): void
  /** 关掉并把卡还回回收池。没开着时是空操作。 */
  hide(): void
}

export interface DeckInspectOptions {
  /** 取当前这套零件。换档位会整套换掉，所以走取值器而不是焊死一份。 */
  parts(): DeckParts
  cards: CardPool
  wake(): void
  /** 玩家点开了一张卡。调用方拿它放音效、记埋点。 */
  onShow(cardId: CardId): void
}

export function createDeckInspect(options: DeckInspectOptions): DeckInspect {
  let shown: { card: CardSprite; cardId: CardId } | null = null

  return {
    get open() {
      return shown !== null
    },

    show(cardId) {
      if (shown !== null) return
      const card = options.cards.take(cardId, `inspect:${cardId}`)
      shown = { card, cardId }
      options.parts().reveal.enter(card, null)
      options.onShow(cardId)
      options.wake()
    },

    hide() {
      const current = shown
      if (current === null) return
      shown = null
      options.parts().reveal.fade()
      // 展示层收场时会把卡摘出去（不销毁），所以这里直接还回回收池。
      options.cards.release(current.card, current.cardId)
      options.wake()
    },
  }
}
