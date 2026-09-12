/**
 * 牌组编辑那一层纯逻辑共用的形状和常量。全是数据，不碰 Pixi。
 *
 * 这一整个目录（logic/）是**先行的一层**：分页、落点、让位、筛选、合法性各是一个纯函数，
 * 不用起画布就测得了（见 canvas/test/deckLogic.test.ts）。场景那边只负责
 * 「把数字变成画面」和「把指针变成调用」，一条判断都不重写。
 * 旧版这些逻辑全埋在 3115 行的 `DeckScreen.tsx` 里，一条都测不动。
 */

import type { CardId } from '@ai-duel/core'

/**
 * 卡池里的一张卡，**由调用方算好交进来**。
 *
 * 三个字段都不是 canvas 能自己算的：`kind` 要查卡表、`faction` 是按 id 前缀分的内容知识、
 * `blockedReason` 要知道哪些牌产品还没开放。它们统一在 content 的 deckPool.ts 里，
 * 而 canvas 不许依赖 content（依赖方向见《正式版架构》7.2 第 1 条）。
 */
export interface PoolCard {
  cardId: CardId
  kind: 'ai' | 'skill'
  /** 阵营 id。canvas 只拿它做相等比较，不认识具体有哪几家。 */
  faction: string
  /** 不为 null 就是这张牌根本选不了，字面就是要印在卡面上的那句话。 */
  blockedReason: string | null
}

/** 种类页签的三档。和 content 的 `DeckCardKindFilter` 是同一组值。 */
export type PoolKind = 'all' | 'ai' | 'skill'

/**
 * 构筑规则里这一页要用到的两个数。
 *
 * 真界面由调用方把 content 的 `DECK_SIZE` / `MAX_COPIES` 传进来（见 client 的 DeckScreen.tsx），
 * 下面那份默认值只是给目录页和测试用的。两处对不上时**以传进来的为准**——
 * 规则的正本在 content，这里只是没法 import 它。
 * client 有一条测试盯着这两个数一致（test/deckRules.test.ts）。
 */
export interface DeckRules {
  /** 一副牌正好几张。 */
  size: number
  /** 同名卡最多带几份。 */
  maxCopies: number
  /**
   * 最多存几套牌组。满了那颗「新建」就灰着。
   *
   * 这一条和上面两条不一样：它是**纯界面约束**（列表再长就没法一眼扫完），
   * 不是玩法规则，所以它的正本在 client 的 save/deckStore.ts（`MAX_DECKS`），
   * content 那边一个字都没有。
   */
  maxDecks: number
}

/** 默认规则。前两个数和 content 的 `DECK_SIZE` / `MAX_COPIES` 一致，理由见 `DeckRules`。 */
export const DEFAULT_DECK_RULES: DeckRules = { size: 20, maxCopies: 3, maxDecks: 12 }

/**
 * 卡池筛选：先按种类，再按阵营。
 *
 * 规则和 content 的 `filterDeckCards` 一字不差，但吃的是**已经算好的** `PoolCard`：
 * 那边要查卡表，这边只做字段比较。content 那份是规则的正本（它对着真卡池测），
 * 改那边的判断这里要跟着改。
 *
 * **阵营只作用于 AI 牌**：技能牌没有阵营，选了阵营也照样一张不少——
 * 把它们一起筛掉等于让玩家选个阵营就再也看不见技能牌，而他并没有表达过「不想看技能牌」。
 */
export function filterPool(
  pool: readonly PoolCard[],
  kind: PoolKind,
  faction: string | null,
): PoolCard[] {
  return pool.filter((card) => {
    if (kind !== 'all' && card.kind !== kind) return false
    if (card.kind === 'skill') return true
    return faction === null || card.faction === faction
  })
}

/** 三个种类页签上各该印几张。**按整个卡池算，不跟着当前筛选变**（含选不了的灰卡）。 */
export function kindCounts(pool: readonly PoolCard[]): Record<PoolKind, number> {
  return {
    all: pool.length,
    ai: pool.filter((card) => card.kind === 'ai').length,
    skill: pool.filter((card) => card.kind === 'skill').length,
  }
}
