/**
 * 剧本用的那一局：最小卡池、题库、牌组，以及「谁在什么时候出哪张牌」的算法。
 *
 * 为什么不用 `content` 的真卡池：6.9 要的是**一段每次跑都一模一样的对局**，
 * 而真卡池会跟着内容迭代变（加一张牌、改一次费用，所有指标就跟着变，历史比不了）。
 * 这里的卡池写死在剧本里，和 `profiles.ts` 里那份牌库是同一批贴图名——
 * 「id 即文件名」那条约定（见 canvas 的 scenes/duel/cardVisuals.ts）让它们直接查得到卡面。
 *
 * 全部费用取 1：开局双方各 5 点 Token，正好够一人打五张，`play10` 那段的十次出牌
 * 因此都落在第一轮里，不用穿过回合结算（那一段有打字机效果，不适合当稳态指标的样本）。
 */

import type { Catalog, Question } from '@ai-duel/core'
import { DECK } from '../node/profiles'

/**
 * 交互用例（tests/interaction.spec.ts）要打的那张技能牌。
 *
 * 目标档选 `own-hand-ai`（模型蒸馏那一档）：它的合法目标是**自己手里**的另一张 AI 牌，
 * 不需要先在场上摆出单位，一局刚发完牌就能走「拖进落区 → 选目标 → 点中」这整条路。
 * 三段确定性剧本抽不到它（它只在 INTERACTION_DECK 里），所以那边的指标一个数都不会动。
 */
export const INTERACTION_SKILL = 'bench-distill'

/** 卡池：`profiles.ts` 那批贴图名各一张 AI 牌，外加交互用例要的那张技能牌。 */
function makeCatalog(): Catalog {
  const cards: Catalog['cards'] = {}
  cards[INTERACTION_SKILL] = {
    kind: 'skill',
    id: INTERACTION_SKILL,
    name: '剧本用的技能牌',
    tokenCost: 1,
    text: '交互用例专用：打自己手里的一张 AI 牌。',
    target: 'own-hand-ai',
  }
  for (const id of DECK) {
    cards[id] = {
      kind: 'ai',
      id,
      name: id,
      model: id,
      skillName: '剧本用的占位技能',
      skillText: '剧本用的占位说明。',
      openrouter: null,
      tokenCost: 1,
      text: '剧本用的占位卡面文案。',
    }
  }
  /*
   * 英雄一个都不带（双方都是 `hero: null`，引擎因此一次都不会去查这张表）。
   * `Catalog.heroes` 的类型要求七位齐全，编七份假英雄只是为了让类型过关。
   */
  return { cards, heroes: {} as Catalog['heroes'] }
}

export const BENCH_CATALOG: Catalog = makeCatalog()

/** 三道题，够打三轮。题面长度取中等——它决定结算层那一屏要烤多少文字。 */
export const BENCH_QUESTIONS: Question[] = [1, 2, 3].map((round) => ({
  id: `bench-q${round}`,
  category: 'meme',
  text: `剧本用的第 ${round} 道题：这句话里到底藏了什么梗？`,
  keywords: ['剧本', '占位'],
  answer: `第 ${round} 题的标准答案`,
  explanation: `第 ${round} 题的解析，两行以内。`,
}))

/**
 * 牌组。**抽牌是从数组末尾取的**（见 core 的 `GameSetup.noShuffle`），
 * 所以最先摸到的那几张写在最后。这里一律用同一批牌，谁先谁后不影响指标。
 */
export const BENCH_DECK = [...DECK, ...DECK].slice(0, 24)

/**
 * 交互用例的牌组：和 `BENCH_DECK` 一样，只是把最先摸到的那张换成技能牌。
 *
 * 抽牌从数组**末尾**取，所以末尾那张是开局第一张。开局发五张，剩下四张都是 AI 牌，
 * 正好当那张技能牌的候选目标。
 */
export const INTERACTION_DECK = [...BENCH_DECK.slice(0, -1), INTERACTION_SKILL]
