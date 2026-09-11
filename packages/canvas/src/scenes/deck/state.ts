/**
 * 构筑页此刻的全部可变状态，以及**改它的那几条纯函数**。
 *
 * 每个改动都是「旧状态 → 新状态」，不碰任何 Pixi 对象。这样「加一张牌之后牌组该长什么样」
 * 在 vitest 里直接断言得了，而画面怎么跟上是 render.ts 的事。
 *
 * 加牌和删牌**不判合法性**：那一条在 logic/legality.ts，由输入层在动手之前先问一遍
 *（拖拽、点「＋」、放大层里那颗「加入牌组」三处问的是同一个函数）。
 * 这里只管「照做」，所以它不需要知道卡池，也不需要知道那三句提示语。
 */

import type { CardId } from '@ai-duel/core'
import type { DeckView } from '../deckContract'
import type { PoolKind } from './logic/types'

export interface DeckState {
  decks: DeckView[]
  currentId: string
  /** 种类页签。 */
  kind: PoolKind
  /** 阵营药丸，null 是「全部阵营」。 */
  faction: string | null
  /** 卡池翻到第几页（从 0 起）。 */
  page: number
  /** 手机档的抽屉展开了没有。桌面档恒为 true——那一档牌组栏一直摊着。 */
  drawerOpen: boolean
}

export function createDeckState(
  decks: readonly DeckView[],
  currentId: string,
  drawerOpen: boolean,
): DeckState {
  return {
    decks: decks.map((deck) => ({ ...deck, cards: [...deck.cards] })),
    currentId,
    kind: 'all',
    faction: null,
    page: 0,
    drawerOpen,
  }
}

/** 当前这一套牌组的牌表。当前 id 指不到人时给空数组（存档保证指得到，这是兜底）。 */
export function currentCards(state: DeckState): readonly CardId[] {
  return state.decks.find((deck) => deck.id === state.currentId)?.cards ?? []
}

/** 当前这一套牌组。指不到人时是 undefined。 */
export function currentDeck(state: DeckState): DeckView | undefined {
  return state.decks.find((deck) => deck.id === state.currentId)
}

/** 把当前牌组的牌表换成 next，别的牌组一个字不动。 */
function withCards(state: DeckState, next: readonly CardId[]): DeckState {
  return {
    ...state,
    decks: state.decks.map((deck) =>
      deck.id === state.currentId ? { ...deck, cards: [...next] } : deck,
    ),
  }
}

/**
 * 往当前牌组的第 at 个位置之前插一张。
 *
 * `at` 由落点算出来（拖拽走 `insertIndexAt`、点「＋」走 `pageInsertIndex`），
 * 越界会被夹回 [0, 张数]。
 */
export function addCard(state: DeckState, cardId: CardId, at: number): DeckState {
  const cards = [...currentCards(state)]
  cards.splice(Math.min(Math.max(0, at), cards.length), 0, cardId)
  return withCards(state, cards)
}

/** 拿掉第 index 张。越界原样返回。 */
export function removeAt(state: DeckState, index: number): DeckState {
  const cards = currentCards(state)
  if (index < 0 || index >= cards.length) return state
  return withCards(state, [...cards.slice(0, index), ...cards.slice(index + 1)])
}

/**
 * 换一套牌组。
 *
 * 顺手把卡池翻回第一页：换牌组多半是要重新配一副，停在第 3 页上等于让人先翻回去。
 * 筛选**不重置**——他刚挑的是「Claude 那一家」，换套牌组还想接着挑那一家。
 */
export function selectDeck(state: DeckState, id: string): DeckState {
  if (id === state.currentId || !state.decks.some((deck) => deck.id === id)) return state
  return { ...state, currentId: id, page: 0 }
}

/**
 * 换种类页签。
 *
 * 阵营**只在「AI 牌」那一页生效**（技能牌没有阵营，见 logic/types.ts 的 `filterPool`），
 * 所以切到别的页签时把阵营收起来；切回来时也不自动恢复——恢复的话玩家会看到一个
 * 他上次选的、这会儿又看不见药丸的筛选在起作用。
 * 换页签一律回第一页：筛出来的是另一批卡，原来的页码指不到任何有意义的地方。
 */
export function selectKind(state: DeckState, kind: PoolKind): DeckState {
  if (kind === state.kind) return state
  return { ...state, kind, faction: kind === 'ai' ? state.faction : null, page: 0 }
}

/** 换阵营药丸。同样回第一页。 */
export function selectFaction(state: DeckState, faction: string | null): DeckState {
  if (faction === state.faction) return state
  return { ...state, faction, page: 0 }
}

/** 翻页。页码夹回有效范围由调用方在算 `pageCount` 之后做（见 logic/pagination.ts）。 */
export function setPage(state: DeckState, page: number): DeckState {
  if (page === state.page) return state
  return { ...state, page }
}

/** 手机档：开关抽屉。 */
export function setDrawerOpen(state: DeckState, open: boolean): DeckState {
  if (open === state.drawerOpen) return state
  return { ...state, drawerOpen: open }
}
