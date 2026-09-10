/**
 * 牌组存档「改」的那半：改名、新建、删除、改卡表，以及教程那条固定 id 的写入。
 * 用例从旧客户端 test/deckStore.test.ts 搬过来。
 *
 * 「读」的那半（播种预设、坏档回落、currentId、存储不可用）在 deckStore.test.ts，
 * 分两份只是因为单文件不能超过 400 行（架构 7.2 第 3 条），共用的脚手架在 helpers/decks.ts。
 *
 * 每个修改函数都是「先读一份、改完写回」，所以这里的断言一律看两处：函数当场返回的那份，
 * 以及再 `loadDecks` 一次读回来的那份——只改内存的话玩家刷新一次编辑就白做了。
 */

import { CARD_POOL, DECK_SIZE, MAX_COPIES } from '@ai-duel/content'
import type { FakePlatform } from '@ai-duel/platform'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DecksData } from '../src/save/deckStore'
import {
  createDeck,
  DECK_NAME_MAX,
  deleteDeck,
  loadDecks,
  MAX_DECKS,
  putDeck,
  renameDeck,
  setCurrentDeck,
  updateDeckCards,
} from '../src/save/deckStore'
import {
  CARD_A,
  CARD_B,
  CARD_C,
  createDeckHarness,
  PRESET_IDS,
  UNAVAILABLE_CARD,
} from './helpers/decks'

let platform: FakePlatform
let newId: () => string
let writeRaw: (value: unknown) => void
let lastDeckId: (data: DecksData | null) => string

describe('牌组编辑', () => {
  beforeEach(() => {
    const harness = createDeckHarness()
    platform = harness.platform
    newId = harness.newId
    writeRaw = harness.writeRaw
    lastDeckId = harness.lastDeckId
  })

  describe('改名', () => {
    it('trim 后截断到 10 个字符', () => {
      loadDecks(platform)
      const data = renameDeck(platform, 'preset-balanced', '  这是一个特别特别长的牌组名字  ')
      expect(data.decks[0]?.name).toBe('这是一个特别特别长的')
      expect(data.decks[0]?.name).toHaveLength(DECK_NAME_MAX)
    })

    it('只有空白的名字回落成原名', () => {
      loadDecks(platform)
      expect(renameDeck(platform, 'preset-balanced', '   ').decks[0]?.name).toBe('默认卡组')
    })

    it('id 不存在时什么都不改', () => {
      const before = loadDecks(platform)
      expect(renameDeck(platform, '不存在', '新名字')).toEqual(before)
    })
  })

  describe('新建牌组', () => {
    it('新建的是空牌组，并且自动切成当前牌组', () => {
      loadDecks(platform)
      const data = createDeck(platform, newId)
      const created = data?.decks.at(-1)
      expect(created?.cards).toEqual([])
      expect(created?.name).toBe('新牌组')
      expect(data?.currentId).toBe(created?.id)
    })

    it('重名自动加序号：新牌组、新牌组 2、新牌组 3', () => {
      loadDecks(platform)
      for (let i = 0; i < 3; i += 1) createDeck(platform, newId)
      const names = loadDecks(platform).decks.map((deck) => deck.name)
      expect(names.slice(-3)).toEqual(['新牌组', '新牌组 2', '新牌组 3'])
    })

    it('把中间那个序号腾出来后，新建会补进这个空位', () => {
      loadDecks(platform)
      createDeck(platform, newId)
      const second = lastDeckId(createDeck(platform, newId))
      createDeck(platform, newId)
      deleteDeck(platform, second, newId)
      expect(createDeck(platform, newId)?.decks.at(-1)?.name).toBe('新牌组 2')
    })

    it('已经有 12 套时不再新建，返回 null', () => {
      loadDecks(platform)
      // 三套预设 + 九套新建正好顶到上限。
      for (let i = 0; i < MAX_DECKS - PRESET_IDS.length; i += 1) {
        expect(createDeck(platform, newId)).not.toBeNull()
      }
      expect(loadDecks(platform).decks).toHaveLength(MAX_DECKS)
      expect(createDeck(platform, newId)).toBeNull()
      expect(loadDecks(platform).decks).toHaveLength(MAX_DECKS)
    })

    it('id 生成器一直返回同一个值时也不会撞出重复 id', () => {
      // 真实的生成器是时间戳 + 随机后缀，同一毫秒里能撞；这里用最坏的情况钉住兜底那条路。
      loadDecks(platform)
      for (let i = 0; i < 3; i += 1) createDeck(platform, () => '固定 id')
      const ids = loadDecks(platform).decks.map((deck) => deck.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('删除牌组', () => {
    /** 三套预设 + 两套新建，够测「删当前」和「删别人」两条路。返回这两套新建的 id。 */
    function seedTwoMoreDecks(): [string, string] {
      loadDecks(platform)
      return [lastDeckId(createDeck(platform, newId)), lastDeckId(createDeck(platform, newId))]
    }

    it('删掉当前牌组后切到剩下的第一套', () => {
      const [first, second] = seedTwoMoreDecks()
      setCurrentDeck(platform, second)
      const data = deleteDeck(platform, second, newId)
      expect(data.decks.map((deck) => deck.id)).toEqual([...PRESET_IDS, first])
      expect(data.currentId).toBe('preset-balanced')
    })

    it('删掉的不是当前牌组时，当前牌组不变', () => {
      const [, second] = seedTwoMoreDecks()
      setCurrentDeck(platform, 'preset-balanced')
      expect(deleteDeck(platform, second, newId).currentId).toBe('preset-balanced')
    })

    it('删到一套不剩时自动补一套空的「新牌组」并设为当前', () => {
      const [first, second] = seedTwoMoreDecks()
      deleteDeck(platform, first, newId)
      deleteDeck(platform, second, newId)
      for (const id of PRESET_IDS.slice(0, -1)) deleteDeck(platform, id, newId)
      const data = deleteDeck(platform, PRESET_IDS.at(-1) ?? '', newId)
      expect(data.decks).toHaveLength(1)
      expect(data.decks[0]?.name).toBe('新牌组')
      expect(data.decks[0]?.cards).toEqual([])
      expect(data.currentId).toBe(data.decks[0]?.id)
      // 补出来的这套要真的存下来，刷新后不能又变回预设。
      expect(loadDecks(platform)).toEqual(data)
    })

    it('id 不存在时什么都不删', () => {
      const before = loadDecks(platform)
      expect(deleteDeck(platform, '不存在', newId)).toEqual(before)
    })
  })

  describe('改卡表', () => {
    /** 用一套空牌组当画布，避免依赖某套预设原有的卡。 */
    function seedEmptyDeck(): void {
      writeRaw({ decks: [{ id: 'a', name: '测试牌组', cards: [] }], currentId: 'a' })
      loadDecks(platform)
    }

    it('过滤掉卡池里没有的卡 id', () => {
      seedEmptyDeck()
      const data = updateDeckCards(platform, 'a', [CARD_A, '并不存在的卡', CARD_B])
      expect(data.decks[0]?.cards).toEqual([CARD_A, CARD_B])
    })

    it('丢掉调不到模型的那种 AI 牌', () => {
      // 这类牌在卡表里查得到、构筑页也灰着摆出来，但不在卡池里，存档里也不该留下。
      seedEmptyDeck()
      const data = updateDeckCards(platform, 'a', [CARD_A, UNAVAILABLE_CARD, CARD_B])
      expect(data.decks[0]?.cards).toEqual([CARD_A, CARD_B])
    })

    it('同一张卡最多留 MAX_COPIES 份', () => {
      seedEmptyDeck()
      const tooManyCopies = Array.from({ length: MAX_COPIES + 1 }, () => CARD_A)
      const data = updateDeckCards(platform, 'a', [...tooManyCopies, CARD_B])
      expect(data.decks[0]?.cards).toEqual([...tooManyCopies.slice(0, MAX_COPIES), CARD_B])
    })

    it('超过 DECK_SIZE 张的部分被截掉', () => {
      seedEmptyDeck()
      const tooMany = CARD_POOL.flatMap((cardId) => [cardId, cardId])
      expect(updateDeckCards(platform, 'a', tooMany).decks[0]?.cards).toHaveLength(DECK_SIZE)
    })

    it('改完立刻存下来，只影响目标牌组', () => {
      loadDecks(platform)
      const other = lastDeckId(createDeck(platform, newId))
      updateDeckCards(platform, other, [CARD_C])
      updateDeckCards(platform, 'preset-balanced', [CARD_A])
      const data = loadDecks(platform)
      expect(data.decks[0]?.cards).toEqual([CARD_A])
      expect(data.decks.find((deck) => deck.id === other)?.cards).toEqual([CARD_C])
    })

    it('id 不存在时什么都不改', () => {
      const before = loadDecks(platform)
      expect(updateDeckCards(platform, '不存在', [CARD_A])).toEqual(before)
    })
  })

  describe('putDeck（教程那条固定 id 的路）', () => {
    it('同一个 id 反复写只覆盖那一套，不动它在列表里的位置', () => {
      loadDecks(platform)
      putDeck(platform, 'tutorial', '教程牌组', [CARD_A])
      const after = putDeck(platform, 'tutorial', '教程牌组', [CARD_B])
      expect(after.decks.filter((deck) => deck.id === 'tutorial')).toHaveLength(1)
      expect(after.decks.at(-1)?.cards).toEqual([CARD_B])
      expect(after.currentId).toBe('tutorial')
    })

    it('已经满 MAX_DECKS 套时挤掉列表最前面那套', () => {
      loadDecks(platform)
      for (let i = 0; i < MAX_DECKS - PRESET_IDS.length; i += 1) createDeck(platform, newId)
      const data = putDeck(platform, 'tutorial', '教程牌组', [CARD_A])
      expect(data.decks).toHaveLength(MAX_DECKS)
      expect(data.decks.map((deck) => deck.id)).not.toContain('preset-balanced')
      expect(data.decks.at(-1)?.id).toBe('tutorial')
    })
  })
})
