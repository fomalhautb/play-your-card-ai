/**
 * 两个单机入口：牌组从哪来、英雄从哪来、座位口径对不对。
 *
 * 「牌组不合法就退回预设」那一条最值得测：`deckStore` 存的是**正在编辑**的牌组，
 * 允许只有几张甚至一张都没有，直接拿去开局会摸空——而摸空要打到第三轮才看得出来。
 */

import { BALANCED_DECK, DECK_SIZE } from '@ai-duel/content'
import type { GameState, PlayerId } from '@ai-duel/core'
import { createFakePlatform } from '@ai-duel/platform'
import { describe, expect, it } from 'vitest'
import { createHotSeatMatch, createTestMatch } from '../src/match/localMatch'
import { loadDecks, resetDeckCacheForTest, updateDeckCards } from '../src/save/deckStore'
import { saveHero } from '../src/save/saveStore'

/**
 * 这一方开局时**整副**牌是哪些。
 *
 * 要把手牌算进来：`createGame` 出来的那一刻起手 5 张已经从牌堆里发走了，
 * 只看 `deck` 会少 5 张。排序之后比，因为牌序是洗过的。
 */
function fullDeck(state: GameState, seat: PlayerId): string[] {
  const player = state.players[seat]
  return [...player.deck, ...player.hand].map((one) => one.cardId).sort()
}

function fresh() {
  // deckStore 的内存缓存是模块级的、跨用例活着，不清会读到上一个用例留下的牌组。
  resetDeckCacheForTest()
  return createFakePlatform()
}

describe('测试房', () => {
  it('己方用存档里当前那副牌，对手固定平衡预设', () => {
    const platform = fresh()
    const driver = createTestMatch(platform, { seed: 1 })
    const state = driver.peek()
    const current = loadDecks(platform)
    const cards = current.decks.find((deck) => deck.id === current.currentId)?.cards ?? []
    expect(fullDeck(state, 0)).toEqual([...cards].sort())
    expect(fullDeck(state, 1)).toEqual([...BALANCED_DECK].sort())
    driver.dispose()
  })

  it('当前牌组不满一副时退回平衡预设', () => {
    const platform = fresh()
    const data = loadDecks(platform)
    // 编到一半就走人：留三张。
    updateDeckCards(platform, data.currentId, BALANCED_DECK.slice(0, 3))
    const driver = createTestMatch(platform, { seed: 1 })
    const deck = fullDeck(driver.peek(), 0)
    expect(deck).toHaveLength(DECK_SIZE)
    expect(deck).toEqual([...BALANCED_DECK].sort())
    driver.dispose()
  })

  it('存过英雄就带上，没存过吃引擎的默认英雄', () => {
    const platform = fresh()
    const before = createTestMatch(platform, { seed: 1 })
    const fallback = before.peek().players[0].hero
    before.dispose()

    saveHero(platform, 'danqi-chen')
    const after = createTestMatch(platform, { seed: 1 })
    expect(after.peek().players[0].hero).toBe('danqi-chen')
    expect(after.peek().players[0].hero).not.toBe(fallback)
    after.dispose()
  })

  it('座位固定 0 号，换手也不动', () => {
    const platform = fresh()
    const driver = createTestMatch(platform, { seed: 1 })
    const active = driver.peek().activePlayer
    driver.send({ type: 'END_PLAY', player: active })
    expect(driver.getSnapshot().seat).toBe(0)
    driver.dispose()
  })
})

describe('热座', () => {
  it('两边同一副牌，视角跟着行动方走', () => {
    const platform = fresh()
    const driver = createHotSeatMatch(platform, { seed: 1 })
    const state = driver.peek()
    expect(fullDeck(state, 0)).toEqual(fullDeck(state, 1))

    const active = state.activePlayer
    expect(driver.getSnapshot().seat).toBe(active)
    driver.send({ type: 'END_PLAY', player: active })
    expect(driver.getSnapshot().seat).not.toBe(active)
    driver.dispose()
  })
})
