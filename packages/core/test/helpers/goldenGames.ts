/**
 * 回放 golden 的名单、文件格式，以及"内容有没有变"的哈希。
 *
 * 录制（golden/record.ts）和回放（replay.test.ts）都读这一份，所以要加一局、换一副牌组，
 * 只改这里，两边不会各说各的。
 */

import { createHash } from 'node:crypto'
import { BALANCED_DECK, HIGH_COST_DECK, LOW_COST_DECK, PREGEN_ANSWERS } from '@ai-duel/content'
import type { Command, GameEvent, PlayerId } from '../../src/index'
import {
  ALL_QUESTION_IDS,
  CATALOG,
  COVERAGE_DECK,
  type PlaySetup,
  type PlaySide,
  questionById,
} from './gameSetup'

/** golden 文件里存的一局。`setup` 原样喂给 gameSetup.ts 的 startGame 就能重开这一局。 */
export interface GoldenGame {
  name: string
  /** 这一局是排来覆盖什么的，给后来改规则的人看。 */
  note: string
  /**
   * 录制时的内容哈希（卡表的规则字段 + 本局用到的题目 + 这些题的预生成回答）。
   * 对不上说明**内容数据**改了，回放的差异先往那边找，别一上来就当成规则改坏了。
   */
  contentHash: string
  setup: PlaySetup
  /** createGame 产生的开局事件。 */
  initialEvents: GameEvent[]
  /** 每条指令和它产生的事件流。 */
  steps: { command: Command; events: GameEvent[] }[]
}

export interface GoldenConfig {
  name: string
  note: string
  seed: number
  players: [PlaySide, PlaySide]
  firstPlayer: PlayerId
  /** 题序按题库原序往后转几格，让几局的题目不重样。 */
  questionOffset: number
}

/** 题库原序旋转 offset 格。旋转而不是随机挑，是为了每局都用满整份题库。 */
function rotatedQuestionIds(offset: number): string[] {
  const at =
    ((offset % ALL_QUESTION_IDS.length) + ALL_QUESTION_IDS.length) % ALL_QUESTION_IDS.length
  return [...ALL_QUESTION_IDS.slice(at), ...ALL_QUESTION_IDS.slice(0, at)]
}

/**
 * 录哪几局。
 *
 * 挑法有三条讲究：
 * - 三副预设牌组两两组合，加两局带 COVERAGE_DECK 的——预设牌组加起来仍有 4 张开放的牌
 *   一次都出不来（元宝、Grok、国产替代、内存紧缺），6.3 要求每张已启用的牌至少被打出一次。
 * - 4 位已实装的英雄各至少上场一次，还要有"不带英雄"的一方（联机里选不到，但引擎允许）。
 * - seed 是**挑出来**的：录制脚本会检查这 6 局加起来有没有把每张开放的牌都打出去，
 *   缺了就整条报错。换牌组或改平衡之后可能要重新挑一遍种子，方法见 test/README.md。
 */
export const GOLDEN_CONFIGS: GoldenConfig[] = [
  {
    name: 'balanced-vs-lowcost',
    note: '平衡牌组对低费流；被动英雄（格蕾丝·霍珀的抵消）对主动升级（陈丹琦）。',
    seed: 1_003_612,
    players: [
      { name: '平衡', deck: BALANCED_DECK.slice(), hero: 'grace-hopper' },
      { name: '低费', deck: LOW_COST_DECK.slice(), hero: 'danqi-chen' },
    ],
    firstPlayer: 0,
    questionOffset: 0,
  },
  {
    name: 'highcost-vs-balanced',
    note: '强卡流对平衡牌组；主动降级（梅拉妮·帕金斯）对开局多 2 点上限（阿达）。',
    seed: 2_000_826,
    players: [
      { name: '强卡', deck: HIGH_COST_DECK.slice(), hero: 'melanie-perkins' },
      { name: '平衡', deck: BALANCED_DECK.slice(), hero: 'ada-lovelace' },
    ],
    firstPlayer: 1,
    questionOffset: 1,
  },
  {
    name: 'lowcost-vs-highcost',
    note: '低费铺场对高费强卡，两边的费用曲线差最远。',
    seed: 3_001_244,
    players: [
      { name: '低费', deck: LOW_COST_DECK.slice(), hero: 'ada-lovelace' },
      { name: '强卡', deck: HIGH_COST_DECK.slice(), hero: 'grace-hopper' },
    ],
    firstPlayer: 0,
    questionOffset: 2,
  },
  {
    name: 'balanced-mirror',
    note: '同副牌组镜像局：两位主动英雄对拼，升级和降级容易撞在同一个单位上。',
    seed: 4_000_825,
    players: [
      { name: '平衡甲', deck: BALANCED_DECK.slice(), hero: 'danqi-chen' },
      { name: '平衡乙', deck: BALANCED_DECK.slice(), hero: 'melanie-perkins' },
    ],
    firstPlayer: 1,
    questionOffset: 3,
  },
  {
    name: 'coverage-vs-balanced',
    note: '覆盖牌组（元宝、Grok、国产替代、内存紧缺）对平衡牌组；先手一方不带英雄。',
    seed: 5_000_553,
    players: [
      { name: '覆盖', deck: COVERAGE_DECK.slice(), hero: null },
      { name: '平衡', deck: BALANCED_DECK.slice(), hero: 'grace-hopper' },
    ],
    firstPlayer: 0,
    questionOffset: 4,
  },
  {
    name: 'coverage-vs-highcost',
    note: '强卡流对覆盖牌组：群体清场（国产替代、内存紧缺）打在一堆高费单位上。',
    seed: 6_000_274,
    players: [
      { name: '强卡', deck: HIGH_COST_DECK.slice(), hero: 'danqi-chen' },
      { name: '覆盖', deck: COVERAGE_DECK.slice(), hero: null },
    ],
    firstPlayer: 1,
    questionOffset: 5,
  },
]

/** 把配置摊成可序列化的开局描述。 */
export function setupOf(config: GoldenConfig): PlaySetup {
  return {
    seed: config.seed,
    players: config.players,
    questionIds: rotatedQuestionIds(config.questionOffset),
    firstPlayer: config.firstPlayer,
  }
}

/**
 * 本局用到的内容数据的哈希。
 *
 * 收进来的是**会改变回放结果**的那些字段，卡面文案之类的不收（改文案不该让 golden 全红）：
 * - 卡牌：费用、种类、选目标那一档、进化链、国产标签，规则读的就是这几个；
 * - 英雄：id 列表（技能怎么结算写在引擎里，不在数据里）；
 * - 题目和它们的预生成回答：事件流里 QUESTION_REVEALED 和 AI_ANSWERED 直接带着这些字段。
 *
 * 排序后再序列化，免得对象键序变一下哈希就变。
 */
export function contentHashFor(questionIds: string[]): string {
  const cards = Object.keys(CATALOG.cards)
    .sort()
    .map((id) => {
      const card = CATALOG.cards[id]!
      return card.kind === 'ai'
        ? [id, card.kind, card.tokenCost, card.domestic === true, card.evolvesTo ?? '']
        : [id, card.kind, card.tokenCost, card.target ?? '']
    })
  const questions = [...questionIds].sort().map((id) => [questionById(id), PREGEN_ANSWERS[id]])
  const payload = JSON.stringify([cards, Object.keys(CATALOG.heroes).sort(), questions])
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}
