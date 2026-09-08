// @vitest-environment happy-dom
/**
 * 存储：JSON 序列化、版本号作废旧档、坏数据一律回落。
 *
 * web 实现和假实现跑同一组用例：它们唯一的差别只该是「字符串存在哪儿」，
 * 别的行为对不上就是假实现在骗人，拿它写的测试也就不算数。
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { StorageCapability, StorageSlot } from '../src/index'
import { createFakePlatform, storageKeyOf } from '../src/index'
import { createWebStorage } from '../src/web/storage'

interface Save {
  wins: number
  cards: string[]
}

/** 当前卡池。存档里不在池子里的卡 id 必须丢掉，否则渲染时才炸——旧代码就是这么做的。 */
const CARD_POOL = ['ai-a', 'ai-b']

function saveSlot(version = 1): StorageSlot<Save> {
  return {
    name: 'ai-duel.save',
    version,
    parse(raw) {
      if (typeof raw !== 'object' || raw === null) return null
      const { wins, cards } = raw as Partial<Save>
      if (typeof wins !== 'number' || !Array.isArray(cards)) return null
      const kept = cards.filter((id) => typeof id === 'string' && CARD_POOL.includes(id))
      // 一张都不剩说明这份存档和当前卡池对不上了，当新号处理。
      if (kept.length === 0) return null
      return { wins, cards: kept }
    },
  }
}

const IMPLEMENTATIONS: ReadonlyArray<[string, () => StorageCapability]> = [
  ['web 实现', () => createWebStorage()],
  ['假实现', () => createFakePlatform().storage],
]

afterEach(() => {
  localStorage.clear()
})

it('键名是「名字.v版本」', () => {
  expect(storageKeyOf(saveSlot(7))).toBe('ai-duel.save.v7')
})

describe.each(IMPLEMENTATIONS)('%s', (_name, create) => {
  it('存进去再读出来，中间过一遍 parse', () => {
    const storage = create()
    const slot = saveSlot()
    storage.write(slot, { wins: 3, cards: ['ai-a', 'ai-b'] })
    expect(storage.read(slot)).toEqual({ wins: 3, cards: ['ai-a', 'ai-b'] })
  })

  it('parse 会把已经不在卡池里的 id 丢掉', () => {
    const storage = create()
    const slot = saveSlot()
    storage.write(slot, { wins: 1, cards: ['ai-a', 'ai-已删除'] })
    expect(storage.read(slot)?.cards).toEqual(['ai-a'])
  })

  it('parse 判作废就当没有存档', () => {
    const storage = create()
    const slot = saveSlot()
    storage.write(slot, { wins: 1, cards: ['ai-已删除'] })
    expect(storage.read(slot)).toBeNull()
  })

  it('换了版本号就读不到旧档', () => {
    const storage = create()
    storage.write(saveSlot(1), { wins: 9, cards: ['ai-a'] })
    expect(storage.read(saveSlot(2))).toBeNull()
    // 旧档没被删，只是再也没人来读它——项目不做迁移，这是预期行为。
    expect(storage.read(saveSlot(1))?.wins).toBe(9)
  })

  it('没存过就是 null，删掉之后也是 null', () => {
    const storage = create()
    const slot = saveSlot()
    expect(storage.read(slot)).toBeNull()
    storage.write(slot, { wins: 1, cards: ['ai-a'] })
    storage.remove(slot)
    expect(storage.read(slot)).toBeNull()
  })
})

describe('web 实现的额外约定', () => {
  it('存的是 JSON 原文，键名带版本号', () => {
    const storage = createWebStorage()
    storage.write(saveSlot(7), { wins: 2, cards: ['ai-a'] })
    expect(localStorage.getItem('ai-duel.save.v7')).toBe('{"wins":2,"cards":["ai-a"]}')
  })

  it('存档被改成半截 JSON 也只是回落，不抛错', () => {
    const storage = createWebStorage()
    localStorage.setItem('ai-duel.save.v1', '{"wins":')
    expect(storage.read(saveSlot())).toBeNull()
  })

  it('浏览器不让碰 localStorage 时读写都不抛', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    // 隐私模式、站点数据被禁的浏览器上，光是取一下 localStorage 就会抛。
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('站点数据被禁用')
      },
    })
    try {
      const storage = createWebStorage()
      const slot = saveSlot()
      expect(() => storage.write(slot, { wins: 1, cards: ['ai-a'] })).not.toThrow()
      expect(storage.read(slot)).toBeNull()
      expect(() => storage.remove(slot)).not.toThrow()
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original)
    }
  })
})

describe('假实现的额外能力', () => {
  it('能塞一段原文进去，模拟被手改过的存档', () => {
    const { storage } = createFakePlatform()
    storage.setRaw('ai-duel.save.v1', '不是 JSON')
    expect(storage.read(saveSlot())).toBeNull()
  })

  it('装成「碰一下就炸」的浏览器时，读写都当没发生', () => {
    const { storage } = createFakePlatform()
    const slot = saveSlot()
    storage.setBroken(true)
    storage.write(slot, { wins: 1, cards: ['ai-a'] })
    expect(storage.read(slot)).toBeNull()
    expect(storage.entries.size).toBe(0)
  })

  it('每次写入报一次，参数是键名', () => {
    const { storage } = createFakePlatform()
    const keys: string[] = []
    storage.onWrite((key) => keys.push(key))
    storage.write(saveSlot(3), { wins: 1, cards: ['ai-a'] })
    expect(keys).toEqual(['ai-duel.save.v3'])
  })
})
