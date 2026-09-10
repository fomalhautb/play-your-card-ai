/**
 * 牌组编辑那一层纯逻辑的测试：网格落点、分页、让位、筛选、合法性。
 *
 * 这一层是**先行**做的（见 scenes/deck/logic/types.ts 的文件头）：拖拽手感的全部就是
 * 「指针停在这儿算插第几个」，而它在旧版里埋在 3115 行的 DeckScreen 里，一条都测不动。
 * 这里一个 Pixi 对象都不建，喂的全是数字。
 *
 * 真指针那一半（按下 / 拖 / 松手串起来）在 deckInput.test.ts。
 */

import { describe, expect, it } from 'vitest'
import {
  cellCenter,
  cellCount,
  type GridSpec,
  gridSize,
  insideGrid,
  nearestCell,
} from '../src/layout/gridMath'
import { insertIndexAt, slotEntries } from '../src/scenes/deck/logic/insert'
import {
  addBlockReason,
  copiesOf,
  isCompleteDeck,
  shortfallOf,
} from '../src/scenes/deck/logic/legality'
import {
  clampPage,
  pageCount,
  pageInsertIndex,
  pageSlice,
} from '../src/scenes/deck/logic/pagination'
import {
  DEFAULT_DECK_RULES,
  filterPool,
  kindCounts,
  type PoolCard,
} from '../src/scenes/deck/logic/types'

/** 牌组那 20 个卡位：2 列 × 10 行，和桌面档版式同一组数（见 layout/desktopLayout.ts）。 */
const SLOTS: GridSpec = {
  x: 100,
  y: 50,
  columns: 2,
  rows: 10,
  cellWidth: 60,
  cellHeight: 90,
  gapX: 10,
  gapY: 10,
}

/** 第 index 格的格心，喂坐标时按它偏移。 */
function center(index: number): { x: number; y: number } {
  return cellCenter(SLOTS, index)
}

/** 第 index 格的左半边 / 右半边各取一点。左半边 = 插它前面，右半边 = 插它后面。 */
function leftOf(index: number): { x: number; y: number } {
  const point = center(index)
  return { x: point.x - 10, y: point.y }
}
function rightOf(index: number): { x: number; y: number } {
  const point = center(index)
  return { x: point.x + 10, y: point.y }
}

describe('网格几何', () => {
  it('格数和整块尺寸按行列数算，空隙只在格与格之间', () => {
    expect(cellCount(SLOTS)).toBe(20)
    expect(gridSize(SLOTS)).toEqual({ width: 2 * 60 + 10, height: 10 * 90 + 9 * 10 })
  })

  it('最近的格子按到格心的距离算，落在空隙上也有答案', () => {
    // 第 0 格和第 1 格中间那条缝：横向偏右一点点，第 1 格更近。
    const gap = { x: SLOTS.x + 60 + 5 + 1, y: center(0).y }
    expect(nearestCell(SLOTS, gap)?.index).toBe(1)
  })

  it('左右半边分得开：只看横向，纵向差半格不改先后', () => {
    expect(nearestCell(SLOTS, leftOf(3))).toEqual({ index: 3, after: false })
    expect(nearestCell(SLOTS, rightOf(3))).toEqual({ index: 3, after: true })
  })

  it('只在前 count 格里找：最后一页不满时不该吸到空格子上', () => {
    const far = center(19)
    expect(nearestCell(SLOTS, far)?.index).toBe(19)
    expect(nearestCell(SLOTS, far, 5)?.index).toBe(4)
  })

  it('外接矩形判「拖进来了没有」', () => {
    expect(insideGrid(SLOTS, center(0))).toBe(true)
    expect(insideGrid(SLOTS, { x: SLOTS.x - 1, y: center(0).y })).toBe(false)
  })
})

describe('拖拽落点', () => {
  const deck = ['a', 'b', 'c', 'd']

  it('落在某一格左半边就插它前面，右半边就插它后面', () => {
    const at = (point: { x: number; y: number }) =>
      insertIndexAt({ grid: SLOTS, deckLength: deck.length, gap: null, point })
    expect(at(leftOf(0))).toBe(0)
    expect(at(rightOf(0))).toBe(1)
    expect(at(leftOf(2))).toBe(2)
    expect(at(rightOf(2))).toBe(3)
  })

  it('落在牌组末尾之后那些空格子上，一律接在最后', () => {
    const at = insertIndexAt({
      grid: SLOTS,
      deckLength: deck.length,
      gap: null,
      point: center(12),
    })
    expect(at).toBe(deck.length)
  })

  it('已经让出空位时，序号要减掉空位自己占的那一格', () => {
    /*
     * 让在第 1 格：屏幕上第 2 格坐的是牌组的第 1 张（b）。
     * 指针停在第 2 格左半边 = 想插到 b 前面 = 第 1 项之前。
     */
    const at = insertIndexAt({ grid: SLOTS, deckLength: deck.length, gap: 1, point: leftOf(2) })
    expect(at).toBe(1)
  })

  it('指针就停在空位上时维持现在这个落点，不来回跳', () => {
    for (const point of [leftOf(1), center(1), rightOf(1)]) {
      expect(insertIndexAt({ grid: SLOTS, deckLength: deck.length, gap: 1, point })).toBe(1)
    }
  })

  it('空牌组：不管指针在哪一格，落点都是 0', () => {
    expect(insertIndexAt({ grid: SLOTS, deckLength: 0, gap: null, point: rightOf(7) })).toBe(0)
  })
})

describe('让位', () => {
  it('空位是多插一个，牌一张都不少', () => {
    expect(slotEntries(['a', 'b', 'c'], 1)).toEqual(['a', null, 'b', 'c'])
    expect(slotEntries(['a', 'b', 'c'], 0)).toEqual([null, 'a', 'b', 'c'])
  })

  it('没有落点时原样返回', () => {
    expect(slotEntries(['a', 'b'], null)).toEqual(['a', 'b'])
  })

  it('落点排到牌组末尾之后时让在最后一格', () => {
    expect(slotEntries(['a', 'b'], 9)).toEqual(['a', 'b', null])
  })
})

describe('卡池分页', () => {
  const cards = Array.from({ length: 26 }, (_, index) => `c${index}`)

  it('一张卡都没有时也算一页', () => {
    expect(pageCount(0, 8)).toBe(1)
    expect(pageCount(26, 8)).toBe(4)
  })

  it('切页取的是这一页那几张，最后一页不满就少给几张', () => {
    expect(pageSlice(cards, 0, 8)).toHaveLength(8)
    expect(pageSlice(cards, 3, 8)).toEqual(['c24', 'c25'])
    expect(pageSlice(cards, 9, 8)).toEqual([])
  })

  it('页码越界时夹到最后一页，而不是弹回开头', () => {
    expect(clampPage(9, 26, 8)).toBe(3)
    expect(clampPage(-2, 26, 8)).toBe(0)
    expect(clampPage(1, 3, 8)).toBe(0)
  })

  it('点「＋」落在当前这一页的第一格；牌组还没排到这一页就接在末尾', () => {
    expect(pageInsertIndex(0, 10, 20)).toBe(0)
    expect(pageInsertIndex(1, 10, 20)).toBe(10)
    expect(pageInsertIndex(1, 10, 3)).toBe(3)
  })
})

describe('卡池筛选', () => {
  const pool: PoolCard[] = [
    { cardId: 'gpt-4o', kind: 'ai', faction: 'gpt', blockedReason: null },
    { cardId: 'claude', kind: 'ai', faction: 'claude', blockedReason: null },
    { cardId: 'grok', kind: 'ai', faction: 'other', blockedReason: null },
    { cardId: 'safe-pass', kind: 'skill', faction: 'other', blockedReason: null },
    { cardId: 'soon', kind: 'skill', faction: 'other', blockedReason: '即将上线' },
  ]

  it('按种类筛', () => {
    expect(filterPool(pool, 'all', null)).toHaveLength(5)
    expect(filterPool(pool, 'ai', null).map((one) => one.cardId)).toEqual([
      'gpt-4o',
      'claude',
      'grok',
    ])
    expect(filterPool(pool, 'skill', null).map((one) => one.cardId)).toEqual(['safe-pass', 'soon'])
  })

  it('阵营只收窄 AI 牌，技能牌一张不少', () => {
    expect(filterPool(pool, 'ai', 'gpt').map((one) => one.cardId)).toEqual(['gpt-4o'])
    expect(filterPool(pool, 'skill', 'gpt')).toHaveLength(2)
    expect(filterPool(pool, 'all', 'gpt').map((one) => one.cardId)).toEqual([
      'gpt-4o',
      'safe-pass',
      'soon',
    ])
  })

  it('页签上的张数按整个卡池算，含选不了的灰卡，不跟着筛选变', () => {
    expect(kindCounts(pool)).toEqual({ all: 5, ai: 3, skill: 2 })
  })
})

describe('加不进去的理由', () => {
  const rules = DEFAULT_DECK_RULES

  it('加得进去时是 null', () => {
    expect(addBlockReason({ deck: [], cardId: 'a', rules, blockedReason: null })).toBeNull()
  })

  it('牌组满 20 张', () => {
    const full = Array.from({ length: 20 }, (_, index) => `c${index}`)
    expect(addBlockReason({ deck: full, cardId: 'a', rules, blockedReason: null })).toBe(
      '牌组已满 20 张',
    )
  })

  it('同名满 3 份', () => {
    expect(
      addBlockReason({ deck: ['a', 'a', 'a', 'b'], cardId: 'a', rules, blockedReason: null }),
    ).toBe('同一张牌最多带 3 份')
    expect(
      addBlockReason({ deck: ['a', 'a', 'a', 'b'], cardId: 'b', rules, blockedReason: null }),
    ).toBeNull()
  })

  it('卡本身选不了时最先说，牌组正好满着也不改口', () => {
    const full = Array.from({ length: 20 }, (_, index) => `c${index}`)
    expect(addBlockReason({ deck: full, cardId: 'soon', rules, blockedReason: '即将上线' })).toBe(
      '即将上线',
    )
    // 移空了它照样加不进来——这正是「先看卡、再看牌组」那条顺序要说清的事。
    expect(addBlockReason({ deck: [], cardId: 'soon', rules, blockedReason: '即将上线' })).toBe(
      '即将上线',
    )
  })

  it('数份数、算还差几张、判满不满', () => {
    expect(copiesOf(['a', 'b', 'a'], 'a')).toBe(2)
    expect(shortfallOf(['a'], rules)).toBe(19)
    expect(
      shortfallOf(
        Array.from({ length: 22 }, () => 'a'),
        rules,
      ),
    ).toBe(0)

    const legal = Array.from({ length: 20 }, (_, index) => `c${Math.floor(index / 2)}`)
    expect(isCompleteDeck(legal, rules)).toBe(true)
    expect(isCompleteDeck(legal.slice(1), rules)).toBe(false)
    expect(
      isCompleteDeck(
        Array.from({ length: 20 }, () => 'a'),
        rules,
      ),
    ).toBe(false)
  })
})
