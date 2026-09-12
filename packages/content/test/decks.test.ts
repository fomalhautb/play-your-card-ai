import { describe, expect, it } from 'vitest'
import {
  CARD_POOL,
  DECK_SIZE,
  isLegalDeck,
  MAX_COPIES,
  PRESET_DECKS,
  SKILL_DESIGN_CARD_IDS,
} from '../src/index'

/**
 * 牌组构筑规则。
 *
 * 这条规则同时是服务端的开局校验（server 的 membership.ts）和客户端构筑页的放行条件，
 * 所以每一条不合法的情形都要有用例：两边靠同一个函数才谈得上口径一致。
 */

/** 拿卡池里的牌拼一副刚好合法的牌组：从头取，同一张最多取 MAX_COPIES 份。 */
function legalDeck(): string[] {
  const cards: string[] = []
  for (const cardId of CARD_POOL) {
    for (let copy = 0; copy < MAX_COPIES && cards.length < DECK_SIZE; copy += 1) {
      cards.push(cardId)
    }
    if (cards.length >= DECK_SIZE) break
  }
  return cards
}

describe('牌组合法性', () => {
  it('三套预设牌组都合法', () => {
    // 预设是新玩家一进来就拿到的牌组，不合法的话他们连开局都点不动。
    for (const deck of PRESET_DECKS) {
      expect(isLegalDeck(deck)).toBe(true)
    }
  })

  it('张数不是 DECK_SIZE 的不合法', () => {
    const deck = legalDeck()
    expect(isLegalDeck(deck.slice(0, DECK_SIZE - 1))).toBe(false)
    expect(isLegalDeck([...deck, deck[0]!])).toBe(false)
  })

  it('同一张卡超过 MAX_COPIES 份的不合法', () => {
    const [card] = CARD_POOL
    const deck = Array.from({ length: DECK_SIZE }, () => card!)
    expect(isLegalDeck(deck)).toBe(false)
  })

  it('正好 MAX_COPIES 份是合法的', () => {
    expect(isLegalDeck(legalDeck())).toBe(true)
  })

  it('卡池外的卡不合法', () => {
    const deck = legalDeck()
    deck[0] = '压根不存在的卡'
    expect(isLegalDeck(deck)).toBe(false)
  })

  it('「即将上线」的技能牌不合法（画得出来，但不该上桌）', () => {
    const pending = SKILL_DESIGN_CARD_IDS.find((id) => !CARD_POOL.includes(id))
    // 全部技能牌都开放之后这条就没得测了，那时它自己跳过。
    if (pending === undefined) return
    const deck = legalDeck()
    deck[0] = pending
    expect(isLegalDeck(deck)).toBe(false)
  })
})
