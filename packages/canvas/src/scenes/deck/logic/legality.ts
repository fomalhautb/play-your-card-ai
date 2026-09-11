/**
 * 「这张牌为什么加不进去」——逐张给出那一句话，`null` 表示加得进去。
 *
 * 返回原因字符串而不是布尔，是抄旧版 `blockReasonNow` 的：拖拽、点「＋」、放大层里那颗
 * 「加入牌组」三处说的必须是同一句，各判各的迟早会出现「这儿说满了、那儿说带不了这么多份」。
 *
 * 判定顺序是硬的：**先看卡本身，再看牌组**。牌组正好满着的时候对一张「即将上线」的牌说
 * 「先移除才能再加」是在骗人——移空了它照样加不进来。
 */

import type { CardId } from '@ai-duel/core'
import type { DeckRules } from './types'

/** 牌组满了。 */
function deckFullTip(rules: DeckRules): string {
  return `牌组已满 ${rules.size} 张`
}

/** 同名带够份数了。 */
function maxCopiesTip(rules: DeckRules): string {
  return `同一张牌最多带 ${rules.maxCopies} 份`
}

export interface AddBlockInput {
  deck: readonly CardId[]
  cardId: CardId
  rules: DeckRules
  /** 这张卡本身的状态（「即将上线」「暂未接入」），能选就是 null。由调用方给，见 logic/types.ts。 */
  blockedReason: string | null
}

/**
 * 现在把这张牌加进牌组，会被什么挡住。
 *
 * 三条一条不落地对应界面上会说的三句话；`null` 就是加得进去。
 */
export function addBlockReason({
  deck,
  cardId,
  rules,
  blockedReason,
}: AddBlockInput): string | null {
  if (blockedReason !== null) return blockedReason
  if (deck.length >= rules.size) return deckFullTip(rules)
  const owned = deck.filter((one) => one === cardId).length
  return owned >= rules.maxCopies ? maxCopiesTip(rules) : null
}

/** 这张牌在牌组里已经带了几份。卡池那张卡角上的「×N」印的就是它。 */
export function copiesOf(deck: readonly CardId[], cardId: CardId): number {
  return deck.filter((one) => one === cardId).length
}

/**
 * 这副牌能不能上桌：张数正好、每张不超份数上限。
 *
 * **不查卡池**——那一条要知道整个卡池，归 content 的 `isLegalDeck`（服务端也查它）。
 * 这里只是界面上那颗「确认牌组」灰不灰的判据，而界面上能加进来的牌本来就都在卡池里。
 */
export function isCompleteDeck(deck: readonly CardId[], rules: DeckRules): boolean {
  if (deck.length !== rules.size) return false
  const copies = new Map<CardId, number>()
  for (const cardId of deck) {
    const used = (copies.get(cardId) ?? 0) + 1
    if (used > rules.maxCopies) return false
    copies.set(cardId, used)
  }
  return true
}

/** 还差几张才满。已经满了（或者超了）就是 0。 */
export function shortfallOf(deck: readonly CardId[], rules: DeckRules): number {
  return Math.max(0, rules.size - deck.length)
}
