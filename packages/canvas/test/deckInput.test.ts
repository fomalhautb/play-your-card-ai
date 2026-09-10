/**
 * 构筑页的交互测试（《正式版架构》6.6 第 2 条、迁移第 28 条）。
 *
 * 走的是 `input.ts` 留出来的合成入口 `pressAt / moveTo / releaseAt`——和真指针走的是
 * 同一条路（真指针只是多了一层 Pixi 事件系统的坐标换算）。断言的是**牌组最后变成了什么样**，
 * 以及有没有往外报一条改动（调用方就是靠那条落盘的，见 deckContract.ts）。
 *
 * 零件是替身，版式是真的（见 helpers/fakeDeckInput.ts）。落点、让位、分页那几条算法
 * 本身有自己的纯函数测试（deckLogic.test.ts），这里只挑「接线对不对」。
 */

import { describe, expect, it } from 'vitest'
import { addFromPool, createDeckInput, type DeckInput } from '../src/scenes/deck/input'
import { pageInsertIndex } from '../src/scenes/deck/logic/pagination'
import { createDeckProbe, type DeckProbe } from './helpers/fakeDeckInput'

/** 完整走一次拖拽：按下 → 过阈值 → 移到落点 → 松手。 */
function drag(
  input: DeckInput,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  input.pressAt(from.x, from.y)
  // 第一步只为了过起拖阈值（4px），第二步才是真正的落点。
  input.moveTo(from.x + 20, from.y)
  input.moveTo(to.x, to.y)
  input.releaseAt(to.x, to.y)
}

function setup(cards: string[] = []): { probe: DeckProbe; input: DeckInput } {
  const probe = createDeckProbe({ cards })
  return { probe, input: createDeckInput(probe.ctx) }
}

describe('从卡池拖进牌组', () => {
  it('拖进牌组栏松手，那张牌进了牌组并往外报了一条', () => {
    const { probe, input } = setup()
    drag(input, probe.poolCenter(0), probe.slotCenter(0))
    expect(probe.cards()).toEqual(['gpt-4o'])
    expect(probe.changes).toEqual([{ cards: ['gpt-4o'], currentId: 'd1' }])
  })

  it('落在某一张的左半边就插它前面，右半边就插它后面', () => {
    const { probe, input } = setup(['a', 'b', 'c'])
    const second = probe.slotCenter(1)
    drag(input, probe.poolCenter(0), { x: second.x - 12, y: second.y })
    expect(probe.cards()).toEqual(['a', 'gpt-4o', 'b', 'c'])
  })

  it('拖到牌组栏外面松手：什么都没发生', () => {
    const { probe, input } = setup()
    drag(input, probe.poolCenter(0), probe.outside())
    expect(probe.cards()).toEqual([])
    expect(probe.changes).toEqual([])
  })

  it('拖的过程中牌组栏让出一格，松手就收掉', () => {
    const { probe, input } = setup(['a', 'b'])
    const target = probe.slotCenter(1)
    input.pressAt(probe.poolCenter(0).x, probe.poolCenter(0).y)
    input.moveTo(probe.poolCenter(0).x + 20, probe.poolCenter(0).y)
    input.moveTo(target.x - 12, target.y)
    expect(probe.ctx.gap).toBe(1)
    input.releaseAt(target.x - 12, target.y)
    expect(probe.ctx.gap).toBeNull()
    expect(probe.cards()).toEqual(['a', 'gpt-4o', 'b'])
  })

  it('走不到阈值就是点了一下：不加牌，改成放大查看', () => {
    const { probe, input } = setup()
    const from = probe.poolCenter(0)
    input.pressAt(from.x, from.y)
    // 只挪 2px，够不着 4px 的起拖阈值。
    input.moveTo(from.x + 2, from.y)
    input.releaseAt(from.x + 2, from.y)
    expect(probe.cards()).toEqual([])
    expect(probe.inspected).toEqual(['gpt-4o'])
  })
})

describe('加不进去的时候', () => {
  it('牌组满 20 张：拖进去也不收', () => {
    const full = Array.from({ length: 20 }, () => 'a')
    const { probe, input } = setup(full)
    drag(input, probe.poolCenter(0), probe.slotCenter(0))
    expect(probe.cards()).toHaveLength(20)
    expect(probe.changes).toEqual([])
  })

  it('同名已经带满 3 份：这一张进不来，别的还能进', () => {
    const { probe, input } = setup(['gpt-4o', 'gpt-4o', 'gpt-4o'])
    drag(input, probe.poolCenter(0), probe.slotCenter(0))
    expect(probe.cards()).toEqual(['gpt-4o', 'gpt-4o', 'gpt-4o'])
    expect(probe.changes).toEqual([])

    // 第 1 格是 gpt-3-5，它一份都还没带。
    drag(input, probe.poolCenter(1), probe.slotCenter(0))
    expect(probe.cards()).toEqual(['gpt-3-5', 'gpt-4o', 'gpt-4o', 'gpt-4o'])
  })

  it('灰卡（「即将上线」）一张都加不进去', () => {
    const { probe, input } = setup()
    // FAKE_POOL 的最后一格就是那张灰卡。
    drag(input, probe.poolCenter(5), probe.slotCenter(0))
    expect(probe.cards()).toEqual([])
    expect(probe.changes).toEqual([])
  })
})

describe('从牌组里拖出去', () => {
  it('松手落在牌组栏外面：这一张被移除', () => {
    const { probe, input } = setup(['a', 'b', 'c'])
    drag(input, probe.slotCenter(1), probe.outside())
    expect(probe.cards()).toEqual(['a', 'c'])
    expect(probe.changes).toEqual([{ cards: ['a', 'c'], currentId: 'd1' }])
  })

  it('拖回卡池也算移除——卡池就在牌组栏外面', () => {
    const { probe, input } = setup(['a', 'b'])
    drag(input, probe.slotCenter(0), probe.poolCenter(0))
    expect(probe.cards()).toEqual(['b'])
  })

  it('在牌组栏里松手：什么都没发生（这一版不支持牌组内换位置）', () => {
    const { probe, input } = setup(['a', 'b', 'c'])
    drag(input, probe.slotCenter(0), probe.slotCenter(2))
    expect(probe.cards()).toEqual(['a', 'b', 'c'])
    expect(probe.changes).toEqual([])
  })

  it('拖出去的那一张在拖的过程中不占格子，也不再让位', () => {
    const { probe, input } = setup(['a', 'b', 'c'])
    const from = probe.slotCenter(1)
    input.pressAt(from.x, from.y)
    input.moveTo(from.x + 20, from.y)
    input.moveTo(probe.slotCenter(2).x, probe.slotCenter(2).y)
    expect(probe.ctx.dragging).toEqual({ from: 'deck', cardId: 'b', index: 1 })
    // 从牌组里拖出来的那张本来就占着一格，再让一格等于凭空多出一个空位。
    expect(probe.ctx.gap).toBeNull()
    input.releaseAt(probe.slotCenter(2).x, probe.slotCenter(2).y)
  })

  it('点一下牌组里的卡也是放大查看', () => {
    const { probe, input } = setup(['gpt-4o'])
    const at = probe.slotCenter(0)
    input.pressAt(at.x, at.y)
    input.releaseAt(at.x, at.y)
    expect(probe.inspected).toEqual(['gpt-4o'])
    expect(probe.cards()).toEqual(['gpt-4o'])
  })
})

describe('点「＋」加牌', () => {
  /** 点「＋」走的落点：当前这一页的第一格（口径见 logic/pagination.ts）。 */
  function addAt(probe: DeckProbe, index: number): boolean {
    const perPage = probe.ctx.parts.poolCells.length
    const deckLength = probe.cards().length
    return addFromPool(probe.ctx, index, pageInsertIndex(0, perPage, deckLength))
  }

  it('落在第一页的第一格，也就是牌组最前面', () => {
    const probe = createDeckProbe({ cards: ['a', 'b'] })
    expect(addAt(probe, 1)).toBe(true)
    expect(probe.cards()).toEqual(['gpt-3-5', 'a', 'b'])
    expect(probe.changes).toEqual([{ cards: ['gpt-3-5', 'a', 'b'], currentId: 'd1' }])
  })

  it('满 20 张、同名满 3 份、灰卡三种情况一律不收，理由和拖拽那条一模一样', () => {
    const full = createDeckProbe({ cards: Array.from({ length: 20 }, () => 'a') })
    expect(addAt(full, 0)).toBe(false)

    const maxed = createDeckProbe({ cards: ['gpt-4o', 'gpt-4o', 'gpt-4o'] })
    expect(addAt(maxed, 0)).toBe(false)

    const blocked = createDeckProbe()
    expect(addAt(blocked, 5)).toBe(false)
    expect(blocked.changes).toEqual([])
  })
})

describe('手机档：抽屉收着的时候', () => {
  it('牌组栏够不着，指针划到那一片也抓不到牌', () => {
    const probe = createDeckProbe({ cards: ['a', 'b'], tier: 'mobile' })
    const input = createDeckInput(probe.ctx)
    const at = probe.slotCenter(0)
    input.pressAt(at.x, at.y)
    input.moveTo(at.x + 20, at.y)
    input.releaseAt(at.x + 20, at.y)
    expect(probe.ctx.dragging).toBeNull()
    expect(probe.cards()).toEqual(['a', 'b'])
  })

  it('从卡池拖过去也不让位、松手也不加牌', () => {
    const probe = createDeckProbe({ tier: 'mobile' })
    const input = createDeckInput(probe.ctx)
    drag(input, probe.poolCenter(0), probe.slotCenter(0))
    expect(probe.ctx.gap).toBeNull()
    expect(probe.cards()).toEqual([])
  })
})
