/**
 * 本地存档的读写行为。
 *
 * 用假平台的 storage：它把「存了什么原文」摊在 `entries` 上，也能一键变成
 * 「碰一下就失败」的浏览器（`setBroken`），两种都不用起真的 localStorage。
 * 用例大部分是从旧客户端 test/save.test.ts 搬过来的，行为要求没变。
 */

import { CARD_POOL, HEROES, INITIAL_COLLECTION } from '@ai-duel/content'
import type { FakePlatform } from '@ai-duel/platform'
import { createFakePlatform } from '@ai-duel/platform'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadSave,
  recordWin,
  resetSave,
  saveHero,
  saveOwnedOrder,
  setReducedMotion,
} from '../src/save/saveStore'

/** 和 saveStore.ts 里的存档位对得上（名字 + 版本号，见 platform 的 storageKeyOf）。 */
const SAVE_KEY = 'ai-duel-save.v3'
/** 上一个版本号。存档不做迁移，换号就等于旧档整份作废。 */
const OLD_SAVE_KEY = 'ai-duel-save.v2'

/**
 * 随便挑一位技能还没实装的英雄，用来测「存档里存着她时要当作没选过」。
 *
 * 不写死是哪一位：这几位迟早会接进引擎、把 comingSoon 撤掉，写死的话那天这条测试
 * 会变成「断言一位已实装的英雄读不回来」，方向正好反了。
 */
const pendingHero = Object.values(HEROES).find((hero) => hero.comingSoon === true)

let platform: FakePlatform

function writeRaw(key: string, value: unknown): void {
  platform.storage.setRaw(key, JSON.stringify(value))
}

describe('本地存档', () => {
  beforeEach(() => {
    platform = createFakePlatform()
  })

  it('没有存档时回落到初始收藏', () => {
    const save = loadSave(platform)
    expect(save.wins).toBe(0)
    expect(save.ownedCards).toEqual(INITIAL_COLLECTION)
  })

  it('存档不是合法 JSON 时回落到初始收藏', () => {
    platform.storage.setRaw(SAVE_KEY, '不是 JSON')
    expect(loadSave(platform).ownedCards).toEqual(INITIAL_COLLECTION)
  })

  it('存档里的卡都不在当前卡池时当作新号处理', () => {
    writeRaw(SAVE_KEY, { ownedCards: ['卡池里已经没有的卡'], wins: 5 })
    expect(loadSave(platform).ownedCards).toEqual(INITIAL_COLLECTION)
  })

  // 胜场是玩家机器上的一段文本，手改成负数或小数之后会一路带进界面，
  // 不如整份当坏档作废——重来一个新号至少是自洽的。
  it('胜场不是非负整数时整份作废', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: -3 })
    expect(loadSave(platform).wins).toBe(0)
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 1.5 })
    expect(loadSave(platform).wins).toBe(0)
  })

  // 现在初始收藏就等于整个卡池，所以新号赢一局是抽不到新卡的。
  // 这条守着「抽不到也不能出错」，卡池扩容后它应该跟着改成断言抽得到。
  it('新号赢一局：胜场 +1，但初始收藏已经是整个卡池，抽不到新卡', () => {
    const { save, drawn } = recordWin(platform, 0)
    expect(save.wins).toBe(1)
    expect(drawn).toBeNull()
    expect(save.ownedCards).toEqual(INITIAL_COLLECTION)
    expect(loadSave(platform)).toEqual(save)
  })

  // 基础收藏始终开放：默认牌组里的卡不能因为「存档里没写」就变成没解锁，
  // 否则改一次默认牌组，老玩家的牌组里就会出现打不出来的卡。
  it('读存档时把基础收藏并回来，额外解锁的卡和胜场都留着', () => {
    writeRaw(SAVE_KEY, { ownedCards: [CARD_POOL[0]], wins: 5 })
    const save = loadSave(platform)
    expect(save.wins).toBe(5)
    for (const id of INITIAL_COLLECTION) expect(save.ownedCards).toContain(id)
    // 并回来的时候不能并出重复项，否则抽卡的候选集会被算错。
    expect(new Set(save.ownedCards).size).toBe(save.ownedCards.length)
  })

  it('卡已经集齐时再赢一局，抽卡结果是 null，收藏不再增长', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 3 })
    const { save, drawn } = recordWin(platform, 0.5)
    expect(drawn).toBeNull()
    expect(save.ownedCards).toEqual(CARD_POOL)
    expect(save.wins).toBe(4)
  })

  it('重置存档回到初始收藏，底下那份记录也被清掉', () => {
    recordWin(platform, 0)
    expect(resetSave(platform)).toEqual({
      ownedCards: INITIAL_COLLECTION,
      wins: 0,
      savedHero: null,
      reducedMotion: false,
    })
    expect(platform.storage.entries.has(SAVE_KEY)).toBe(false)
  })

  // 牌组归 deckStore 管，这份存档里只剩英雄这一个选择结果。
  it('确认过的英雄写入后能读回来，收藏和胜场不受影响', () => {
    const before = loadSave(platform)
    saveHero(platform, 'ada-lovelace')
    const save = loadSave(platform)
    expect(save.savedHero).toBe('ada-lovelace')
    expect(save.ownedCards).toEqual(before.ownedCards)
    expect(save.wins).toBe(before.wins)
  })

  // 构筑页把牌从牌组拖回卡池时可以指定放在哪一格，落盘的就是那一下之后的顺序。
  it('卡池的新顺序能存下来并读回去', () => {
    const before = loadSave(platform).ownedCards
    const moved = [...before.slice(-1), ...before.slice(0, -1)]
    saveOwnedOrder(platform, moved)
    expect(loadSave(platform).ownedCards).toEqual(moved)
  })

  it('新顺序里混进的陌生 id 被丢掉，漏掉的卡按原顺序补在后面', () => {
    const before = loadSave(platform).ownedCards
    saveOwnedOrder(platform, [...before.slice(2, 3), '不在收藏里的卡'])
    const after = loadSave(platform).ownedCards
    expect(after[0]).toBe(before[2])
    expect(after).not.toContain('不在收藏里的卡')
    // 一张都不能少。
    expect(new Set(after)).toEqual(new Set(before))
  })

  // 「减少动效」这一位的三条：默认关、写进去能读回来、写坏了按关算。
  // 默认关是安全的那一档——系统级的 prefers-reduced-motion 走 CSS，不经过存档。
  it('新号默认不开减少动效', () => {
    expect(loadSave(platform).reducedMotion).toBe(false)
  })

  it('开了减少动效之后读得回来，别的字段不受影响', () => {
    saveHero(platform, 'ada-lovelace')
    setReducedMotion(platform, true)
    const save = loadSave(platform)
    expect(save.reducedMotion).toBe(true)
    expect(save.savedHero).toBe('ada-lovelace')
  })

  it('减少动效那一位不是布尔值时按「没开」算', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...INITIAL_COLLECTION], wins: 0, reducedMotion: '开' })
    expect(loadSave(platform).reducedMotion).toBe(false)
  })

  // 不写迁移代码：换版本号就等于旧档整份作废，读到的是一份全新的存档。
  it('上一版存档位里的数据读不到，回落成新号', () => {
    writeRaw(OLD_SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 9, savedHero: 'grace-hopper' })
    const save = loadSave(platform)
    expect(save.wins).toBe(0)
    expect(save.savedHero).toBeNull()
  })

  it('存档里的英雄不在英雄表里时读回 null', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 0, savedHero: '没有这个英雄' })
    expect(loadSave(platform).savedHero).toBeNull()
  })

  // 校验走 zod 的 enum 而不是 `in`，所以原型链上那些名字也算「不在英雄表里」——
  // 手改过的存档写个 "toString" 不能取到 Object 原型上的东西再一路带进对局。
  it('存档里的英雄是 Object 原型上的名字时读回 null', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 0, savedHero: 'toString' })
    expect(loadSave(platform).savedHero).toBeNull()
  })

  // 选英雄界面把 comingSoon 的几位置灰禁选了，存档里要是留着这么一位，
  // 下次进流程就会预填一位现在选不了的英雄。
  it.skipIf(pendingHero === undefined)('存档里的英雄技能还没实装时读回 null', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 0, savedHero: pendingHero?.id })
    expect(loadSave(platform).savedHero).toBeNull()
  })

  // 反过来的一半：已实装的英雄不能被上面那条规则误伤。
  it('存档里的英雄技能已实装时照常读回来', () => {
    writeRaw(SAVE_KEY, { ownedCards: [...CARD_POOL], wins: 0, savedHero: 'grace-hopper' })
    expect(loadSave(platform).savedHero).toBe('grace-hopper')
  })

  // 隐私模式那种「碰一下存储就失败」的浏览器上游戏照常能玩，只是这次的进度存不下来。
  it('存储整个不可用时不抛错，只是存不下', () => {
    platform.storage.setBroken(true)
    expect(() => recordWin(platform, 0)).not.toThrow()
    expect(recordWin(platform, 0).save.wins).toBe(1)
    expect(loadSave(platform).wins).toBe(0)
  })
})
