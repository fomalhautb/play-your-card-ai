/**
 * 牌组存档两份测试（deckStore.test.ts 读档那半、deckEdit.test.ts 编辑那半）共用的脚手架。
 *
 * 拆成两份是因为单文件不能超过 400 行（架构 7.2 第 3 条），而这些常量和小工具
 * 两边都要用，抄一份迟早对不上。
 */

import { CARD_POOL, UNAVAILABLE_AI_CARD_IDS } from '@ai-duel/content'
import type { FakePlatform } from '@ai-duel/platform'
import { createFakePlatform } from '@ai-duel/platform'
import type { DecksData } from '../../src/save/deckStore'
import { resetDeckCacheForTest } from '../../src/save/deckStore'

/** 和 deckStore.ts 里的存档位对得上（名字 + 版本号，见 platform 的 storageKeyOf）。 */
export const DECKS_KEY = 'ai-duel-decks.v1'
export const PRESET_IDS = ['preset-balanced', 'preset-low-cost', 'preset-high-cost']
export const PRESET_NAMES = ['默认卡组', '低费流', '强卡流']

/** 测试里当素材用的三张真卡。从卡池头上取，不写死 id：卡池改名时这份测试跟着走。 */
export const [CARD_A, CARD_B, CARD_C] = [CARD_POOL[0]!, CARD_POOL[1]!, CARD_POOL[2]!]
/** 调不到模型、进不了卡池的那种 AI 牌，用来验存档会把它剔掉。 */
export const UNAVAILABLE_CARD = UNAVAILABLE_AI_CARD_IDS[0]!

export interface DeckHarness {
  platform: FakePlatform
  /** id 生成器由调用方给（见 createDeck 的说明），测试里用递增序号，结果才可复现。 */
  newId(): string
  /** 直接往存档位塞一份原文，用来构造「已经存过」的起始状态。 */
  writeRaw(value: unknown): void
  lastDeckId(data: DecksData | null): string
}

/**
 * 每个用例开头调一次。
 *
 * 顺手清掉 deckStore 的内存缓存：它是模块级变量、跨用例活着，不清的话
 * 「读不回来就用缓存」那条路径会读到上一个用例留下的牌组。
 */
export function createDeckHarness(): DeckHarness {
  resetDeckCacheForTest()
  const platform = createFakePlatform()
  let counter = 0
  return {
    platform,
    newId() {
      counter += 1
      return `deck-${counter}`
    },
    writeRaw(value) {
      platform.storage.setRaw(DECKS_KEY, JSON.stringify(value))
    },
    lastDeckId: (data) => data?.decks.at(-1)?.id ?? '',
  }
}
