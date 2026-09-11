/**
 * 属性测试和回放 golden 共用的开局描述。
 *
 * 这里的 `PlaySetup` 是 `GameSetup` 的**可 JSON 序列化**版本：目录和题库都换成 id 引用，
 * 所以它能原样写进 golden 文件，重放时再用 `startGame` 还原成真正的一局。
 * 目录本身不进 golden——那是几十张卡的卡面文案，太大而且是公开数据，
 * 重放时统一用 `createCatalog()`，靠 goldenContent.ts 里那份内容哈希对账。
 */

import { createCatalog, QUESTION_POOL } from '@ai-duel/content'
import type { CardId, ExecuteResult, HeroId, PlayerId, Question } from '../../src/index'
import { createGame } from '../../src/index'

/** 目录是只读的，全套测试共用一份就够（引擎一个字都不改它，见 src/cards.ts 的 Catalog）。 */
export const CATALOG = createCatalog()

const QUESTIONS_BY_ID = new Map<string, Question>(QUESTION_POOL.map((q) => [q.id, q]))

/** 题库全部题目的 id，按 content 里的原始顺序。 */
export const ALL_QUESTION_IDS: string[] = QUESTION_POOL.map((q) => q.id)

export interface PlaySide {
  name: string
  deck: CardId[]
  /** null 表示这一方不带英雄；这里一律写明，不吃 createGame 的默认英雄。 */
  hero: HeroId | null
}

export interface PlaySetup {
  seed: number
  players: [PlaySide, PlaySide]
  /**
   * 本局的题序，按题目 id 引用 content 的题库。
   *
   * 一定要显式给，不能让引擎去洗题库：洗题会推进 `createGame` 里那把随机数生成器，
   * 录制时洗过、重放时没洗（或反过来）的话，后面双方牌堆的顺序和状态里留下的种子全都对不上。
   */
  questionIds: string[]
  /** 指定第一轮先手，不填就按 seed 抛硬币。 */
  firstPlayer?: PlayerId
  /** 牌组按传入顺序原样使用，不洗（见 GameSetup.noShuffle）。 */
  noShuffle?: boolean
}

/** 按 id 取题目。取不到说明 golden 引用的题目被删了，属于内容改动，当场报清楚。 */
export function questionById(id: string): Question {
  const question = QUESTIONS_BY_ID.get(id)
  if (!question) throw new Error(`题库里没有这道题：${id}（golden 引用的题目被删了？）`)
  return question
}

/** 把可序列化的开局描述还原成真正的一局。 */
export function startGame(setup: PlaySetup): ExecuteResult {
  return createGame({
    seed: setup.seed,
    catalog: CATALOG,
    questionPool: QUESTION_POOL,
    questions: setup.questionIds.map(questionById),
    players: [
      { name: setup.players[0].name, deck: setup.players[0].deck, hero: setup.players[0].hero },
      { name: setup.players[1].name, deck: setup.players[1].deck, hero: setup.players[1].hero },
    ],
    firstPlayer: setup.firstPlayer,
    noShuffle: setup.noShuffle,
  })
}

/**
 * 只覆盖预设牌组够不到的那几张牌的测试牌组：元宝、Grok 两张 AI，
 * 以及「国产替代」「内存紧缺」两张 6 费群体技能。
 *
 * 三副预设牌组（content 的 PRESET_DECKS）加起来仍有 4 张开放的牌一次都出不来，
 * 而 6.3 要求每张已启用的牌至少被打出一次，所以专门排这一副。
 * 配比照着预设的路子来：14 张 AI + 6 张技能，同名卡最多 3 张。
 * AI 位一半国产一半不是，「国产替代」打出去才有得清。
 */
export const COVERAGE_DECK: CardId[] = [
  // AI 14 张：国产 10（元宝、豆包、通义、MiniMax），非国产 4（Grok、Gemini）
  'yuanbao',
  'yuanbao',
  'yuanbao',
  'doubao',
  'doubao',
  'doubao',
  'qwen',
  'qwen',
  'minimax',
  'minimax',
  'grok',
  'grok',
  'grok',
  'gemini',
  // 技能 6 张：两张 6 费群体技能各 3 张
  'domestic-substitution',
  'domestic-substitution',
  'domestic-substitution',
  'memory-shortage',
  'memory-shortage',
  'memory-shortage',
]
