/**
 * 组装构筑页那份共用上下文（`DeckContext`），连带卡的**借还账**。
 *
 * 从 DeckScene.ts 里拎出来的（400 行那条上限逼的）。借还账跟着上下文走而不是跟着场景走，
 * 是因为它只服务 `takeCard / beginBorrow / endBorrow` 这三条——场景那边一次都不读它。
 *
 * `parts` 和 `layout` 走取值器：换档位会整套换掉零件、改视口会换掉版式，
 * 而 render 和 input 手里的是同一个对象，取值器让它们始终看到当前那一份。
 */

import type { CardId } from '@ai-duel/core'
import type { Container } from 'pixi.js'
import type { CardSprite } from '../../components/CardSprite'
import type { Animator } from '../../runtime/animator'
import type { DeckManageAction, DeckSceneOptions } from '../deckContract'
import type { CardPool } from './cards'
import type { DeckContext } from './context'
import type { InspectOrigin } from './inspect'
import type { DeckLayout } from './layout/types'
import { DEFAULT_DECK_RULES } from './logic/types'
import type { DeckParts } from './partsSpec'
import type { ScrollState } from './scroll'
import { createDeckState } from './state'

export interface DeckContextHost {
  parts(): DeckParts
  layout(): DeckLayout
  cards: CardPool
  animator: Animator
  stage: Container
  cardTilt: boolean
  poolScroll: ScrollState
  slotScroll: ScrollState
  wake(): void
  emitChange(): void
  emitInspect(origin: InspectOrigin): void
  refuse(cardId: CardId, card: CardSprite | null): void
  emitManage(action: DeckManageAction): void
}

export function createDeckContext(options: DeckSceneOptions, host: DeckContextHost): DeckContext {
  /**
   * 这一轮借出去摆着的卡，以及上一轮那批（`stale`）。
   *
   * 「上一轮借过、这一轮还要」的卡从 `stale` 里原样取回来——它因此仍然挂在原来那一格上，
   * 一次重挂都不用（重排画面是这一页最频繁的事，见 render.ts 的文件头）。
   * 这一轮没再被要到的，到 `endBorrow` 那一步才真的还回回收池。
   */
  let borrowed = new Map<CardSprite, CardId>()
  let stale = new Map<CardSprite, CardId>()

  return {
    pool: options.pool,
    factions: options.factions,
    rules: options.rules ?? DEFAULT_DECK_RULES,
    get parts() {
      return host.parts()
    },
    get layout() {
      return host.layout()
    },
    animator: host.animator,
    stage: host.stage,
    cardTilt: host.cardTilt,
    // 手机档一进来抽屉是收着的：卡池才是这一屏的主角。桌面档没有抽屉，恒为展开。
    state: createDeckState(options.decks, options.currentId, host.layout().tier === 'desktop'),
    gap: null,
    dragging: null,
    poolScroll: host.poolScroll,
    slotScroll: host.slotScroll,

    takeCard(cardId, tag) {
      // 上一轮那批里有同一张牌的话原样取回来：它还在原位，谁都不用动。
      for (const [card, id] of stale) {
        if (id !== cardId) continue
        stale.delete(card)
        borrowed.set(card, cardId)
        return card
      }
      const card = host.cards.take(cardId, tag)
      borrowed.set(card, cardId)
      return card
    },
    holdCard: (cardId, tag) => host.cards.take(cardId, tag),
    beginBorrow() {
      stale = borrowed
      borrowed = new Map()
    },
    endBorrow() {
      for (const [card, cardId] of stale) host.cards.release(card, cardId)
      stale.clear()
    },
    releaseCard: (card, cardId) => host.cards.release(card, cardId),
    wake: () => host.wake(),
    emitChange: () => host.emitChange(),
    emitInspect: (origin) => host.emitInspect(origin),
    refuse: (cardId, card) => host.refuse(cardId, card),
    emitManage: (action) => host.emitManage(action),
  }
}
