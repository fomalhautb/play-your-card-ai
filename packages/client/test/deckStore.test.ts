/**
 * 牌组存档「读」的那半：播种预设、坏档回落、currentId，以及存储不可用时的接力。
 * 用例从旧客户端 test/deckStore.test.ts 搬过来。
 *
 * 「改」的那半（改名、新建、删除、改卡表、putDeck）在 deckEdit.test.ts，
 * 分两份只是因为单文件不能超过 400 行（架构 7.2 第 3 条），共用的脚手架在 helpers/decks.ts。
 *
 * 读写走假平台的 storage。`setBroken(true)` 对应隐私模式那种环境：那里读不回任何东西，
 * 这个模块靠内存缓存把一次会话里的连续编辑接起来（见 deckStore 的 `cached`），
 * 最后一组就是在验这条。
 */

import { CARD_POOL, DECK_SIZE, MAX_COPIES, PRESET_DECKS } from '@ai-duel/content'
import type { FakePlatform } from '@ai-duel/platform'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DecksData } from '../src/save/deckStore'
import {
  createDeck,
  deleteDeck,
  loadDecks,
  MAX_DECKS,
  renameDeck,
  resetDecks,
  setCurrentDeck,
  updateDeckCards,
} from '../src/save/deckStore'
import {
  CARD_A,
  CARD_B,
  createDeckHarness,
  DECKS_KEY,
  PRESET_IDS,
  PRESET_NAMES,
} from './helpers/decks'

let platform: FakePlatform
let newId: () => string
let writeRaw: (value: unknown) => void
let lastDeckId: (data: DecksData | null) => string

function countCopies(cards: readonly string[], cardId: string): number {
  return cards.filter((id) => id === cardId).length
}

describe('牌组存档', () => {
  beforeEach(() => {
    const harness = createDeckHarness()
    platform = harness.platform
    newId = harness.newId
    writeRaw = harness.writeRaw
    lastDeckId = harness.lastDeckId
  })

  describe('播种预设', () => {
    it('没有存档时播种三套预设，默认选中第一套', () => {
      const data = loadDecks(platform)
      expect(data.decks.map((deck) => deck.id)).toEqual(PRESET_IDS)
      expect(data.decks.map((deck) => deck.name)).toEqual(PRESET_NAMES)
      expect(data.currentId).toBe('preset-balanced')
    })

    // 预设直接取 content 的三副预设牌组，它们本来就是能开局的牌，这里守着「没在存档层被改坏」。
    it('三套预设逐副对上 content：各 20 张、卡都在卡池里、同名不超过 MAX_COPIES 份', () => {
      const { decks } = loadDecks(platform)
      expect(decks.map((deck) => deck.cards)).toEqual(PRESET_DECKS.map((cards) => [...cards]))
      for (const deck of decks) {
        expect(deck.cards).toHaveLength(DECK_SIZE)
        for (const cardId of deck.cards) {
          expect(CARD_POOL).toContain(cardId)
          expect(countCopies(deck.cards, cardId)).toBeLessThanOrEqual(MAX_COPIES)
        }
      }
    })

    it('播种结果立刻写回存档，再读一次拿到的是同一份', () => {
      const first = loadDecks(platform)
      expect(platform.storage.entries.has(DECKS_KEY)).toBe(true)
      expect(loadDecks(platform)).toEqual(first)
    })

    it('预设可以改名和删除，都不会被播种覆盖回去', () => {
      loadDecks(platform)
      renameDeck(platform, 'preset-balanced', '我的牌组')
      deleteDeck(platform, 'preset-low-cost', newId)
      const { decks } = loadDecks(platform)
      expect(decks[0]?.name).toBe('我的牌组')
      expect(decks.map((deck) => deck.id)).not.toContain('preset-low-cost')
    })

    // 「重置存档」调的就是它。和 resetSave 是两份存档，漏掉这一半的话，
    // 重置完还留着上次改过的牌组，三套预设永远回不来。
    it('resetDecks 把改过、删过的牌组清掉，重新播回三套预设', () => {
      loadDecks(platform)
      renameDeck(platform, 'preset-balanced', '我的牌组')
      deleteDeck(platform, 'preset-low-cost', newId)
      createDeck(platform, newId)

      const data = resetDecks(platform)
      expect(data.decks.map((deck) => deck.id)).toEqual(PRESET_IDS)
      expect(data.decks.map((deck) => deck.name)).toEqual(PRESET_NAMES)
      expect(data.currentId).toBe('preset-balanced')
      // 也得写回存档：只改内存的话刷新一次又回到旧牌组。
      expect(loadDecks(platform)).toEqual(data)
    })
  })

  describe('坏档回落', () => {
    it('不是合法 JSON 时重新播种', () => {
      platform.storage.setRaw(DECKS_KEY, '不是 JSON')
      expect(loadDecks(platform).decks.map((deck) => deck.id)).toEqual(PRESET_IDS)
    })

    it('decks 不是数组时重新播种', () => {
      writeRaw({ decks: '一套牌组', currentId: 'x' })
      expect(loadDecks(platform).decks.map((deck) => deck.id)).toEqual(PRESET_IDS)
    })

    it('每一条都不合法（没有 id）时重新播种', () => {
      writeRaw({ decks: [{ name: '没有 id' }, null, 42], currentId: 'x' })
      expect(loadDecks(platform).decks.map((deck) => deck.id)).toEqual(PRESET_IDS)
    })

    it('重复 id 只留第一条', () => {
      writeRaw({
        decks: [
          { id: 'a', name: '一号', cards: [] },
          { id: 'a', name: '冒牌', cards: [] },
          { id: 'b', name: '二号', cards: [] },
        ],
        currentId: 'a',
      })
      const data = loadDecks(platform)
      expect(data.decks.map((deck) => deck.id)).toEqual(['a', 'b'])
      expect(data.decks[0]?.name).toBe('一号')
    })

    it('牌组套数超上限时只留前 12 套', () => {
      writeRaw({
        decks: Array.from({ length: MAX_DECKS + 5 }, (_, index) => ({
          id: `d${index}`,
          name: `牌组${index}`,
          cards: [],
        })),
        currentId: 'd0',
      })
      expect(loadDecks(platform).decks).toHaveLength(MAX_DECKS)
    })

    it('名字缺失或不是字符串时回落成「新牌组」', () => {
      writeRaw({ decks: [{ id: 'a', name: 42, cards: [] }], currentId: 'a' })
      expect(loadDecks(platform).decks[0]?.name).toBe('新牌组')
    })

    // 卡表的规整规则在 deckEdit.test.ts 那份里逐条测；这里只守「读档这条路也走同一遍规整」。
    it('存档里被改坏的卡表读出来是干净的', () => {
      writeRaw({
        decks: [{ id: 'a', name: '测试牌组', cards: [CARD_A, CARD_A, CARD_A, CARD_A, '野卡'] }],
        currentId: 'a',
      })
      expect(loadDecks(platform).decks[0]?.cards).toEqual([CARD_A, CARD_A, CARD_A])
    })

    it('cards 不是数组时读成空牌组', () => {
      writeRaw({ decks: [{ id: 'a', name: '测试牌组', cards: CARD_A }], currentId: 'a' })
      expect(loadDecks(platform).decks[0]?.cards).toEqual([])
    })
  })

  describe('currentId', () => {
    it('指向不存在的牌组时回落到第一套', () => {
      writeRaw({
        decks: [
          { id: 'a', name: '一号', cards: [] },
          { id: 'b', name: '二号', cards: [] },
        ],
        currentId: '早就删了的牌组',
      })
      expect(loadDecks(platform).currentId).toBe('a')
    })

    it('setCurrentDeck 切到存在的牌组，切换结果会存下来', () => {
      loadDecks(platform)
      const id = lastDeckId(createDeck(platform, newId))
      expect(setCurrentDeck(platform, 'preset-balanced').currentId).toBe('preset-balanced')
      expect(setCurrentDeck(platform, id).currentId).toBe(id)
      expect(loadDecks(platform).currentId).toBe(id)
    })

    it('setCurrentDeck 传不存在的 id 时不生效', () => {
      loadDecks(platform)
      expect(setCurrentDeck(platform, '不存在').currentId).toBe('preset-balanced')
    })
  })

  describe('存储不可用', () => {
    it('读不回来时接着用内存里那份，一次会话里的编辑不会被打回预设', () => {
      // 先正常读一次把预设播下去，再让存储坏掉。
      expect(loadDecks(platform).decks).toHaveLength(PRESET_IDS.length)
      platform.storage.setBroken(true)

      const created = createDeck(platform, newId)
      expect(created?.decks).toHaveLength(PRESET_IDS.length + 1)
      const id = created?.currentId ?? ''

      // 新建的这套还在，改名落在它头上，而不是读回预设后什么都改不到。
      const renamed = renameDeck(platform, id, '断档牌组')
      expect(renamed.decks.find((deck) => deck.id === id)?.name).toBe('断档牌组')

      // 加卡写进新牌组自己，不会因为读回预设而落到 preset-balanced 头上。
      const withCards = updateDeckCards(platform, id, [CARD_A, CARD_B])
      expect(withCards.currentId).toBe(id)
      expect(withCards.decks.find((deck) => deck.id === id)?.cards).toEqual([CARD_A, CARD_B])
      expect(withCards.decks.find((deck) => deck.id === 'preset-balanced')?.cards).toHaveLength(
        DECK_SIZE,
      )

      // 再读一次拿到的还是这份连续的编辑结果。
      expect(loadDecks(platform)).toEqual(withCards)
    })

    it('一次都没读成功过时照旧播种预设', () => {
      platform.storage.setBroken(true)
      expect(loadDecks(platform).decks.map((deck) => deck.id)).toEqual(PRESET_IDS)
    })
  })
})
