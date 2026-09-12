/**
 * 构筑规则那三个数在三个包里对得上。
 *
 * 为什么会有三份：`DECK_SIZE` 和 `MAX_COPIES` 的正本在 content（服务端开局时也要查），
 * `MAX_DECKS` 的正本在存档那边（它是纯界面约束）；而 `canvas` 不许依赖这两个包
 *（依赖方向见《正式版架构》7.2 第 1 条），只能自己带一份**默认值**给目录页和测试用。
 *
 * 真界面走的是 `DeckStage.tsx` 传进去的那一份，所以对不上也不会当场坏掉——
 * 坏的是目录页和 bench 里那几屏会按另一套规矩画（比如「已选 N / 24」）。
 * 这条测试就是拦这个：`client` 是唯一同时看得见三处的地方。
 */

import { DEFAULT_DECK_RULES } from '@ai-duel/canvas'
import { DECK_SIZE, MAX_COPIES } from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import { MAX_DECKS } from '../src/save/deckStore'

describe('构筑规则三处一致', () => {
  it('canvas 的默认值和 content、存档那两处对得上', () => {
    expect(DEFAULT_DECK_RULES).toEqual({
      size: DECK_SIZE,
      maxCopies: MAX_COPIES,
      maxDecks: MAX_DECKS,
    })
  })

  it('三个数本身是合理的：一副牌装得下、份数不超过张数', () => {
    expect(DECK_SIZE).toBeGreaterThan(0)
    expect(MAX_COPIES).toBeGreaterThan(0)
    expect(MAX_COPIES).toBeLessThanOrEqual(DECK_SIZE)
    expect(MAX_DECKS).toBeGreaterThan(0)
  })
})
