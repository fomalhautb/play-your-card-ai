/**
 * 两个单机入口：dev 测试房和热座。两者都只是给 `localDriver` 配一份 `GameSetup`。
 *
 * 分成两个函数而不是一个带开关的：它们回答的是不同的问题——测试房是「一个人要把对局
 * 界面整套跑一遍」，热座是「一台机器上两个人对打」。共用的只有「牌组从哪来」这一件事。
 *
 * 两条路都不是另开一条渲染管线：driver → MatchScreen → DuelScene 这条链和联机完全一样，
 * 只是把「对手的指令从服务端来」换成「从测试面板 / 旁边那个人来」。
 * 所以在这两种玩法里看到的界面行为，就是联机时真实会发生的行为。
 */

import { BALANCED_DECK, createCatalog, QUESTION_POOL } from '@ai-duel/content'
import type { GameSetup, HeroId } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { currentDeck, currentHero } from '../save/loadout'
import { createLocalDriver, type LocalDriver } from './localDriver'

/**
 * 存档里确认过的英雄，摆成 `GameSetup` 要的形状：没选过就整个字段不出现，
 * 让引擎吃它自己的默认英雄。取值本身在 save/loadout.ts，联机那边报的是同一份。
 */
function savedHero(platform: Platform): { hero?: HeroId } {
  const hero = currentHero(platform)
  return hero === null ? {} : { hero }
}

/**
 * 一局的骨架：种子、卡池、题库。
 *
 * 题库**不裁**：一轮最多拿 1 分而先到 3 分才结束（core 的 `WIN_TARGET`），
 * 只塞一道题的话永远打不出真实终局，也就验不到「先到 3 分提前收场」这条。
 * 想快点看结算就用测试面板的「跳到答题」连点几轮。
 *
 * 种子由调用方摇（默认当前时刻）：这个模块和 `content` 一样保持可复现，
 * 端到端用例要定一局固定的对战时把它传进来就行。
 */
function baseSetup(seed: number): Pick<GameSetup, 'seed' | 'catalog' | 'questionPool'> {
  return { seed, catalog: createCatalog(), questionPool: QUESTION_POOL }
}

export interface LocalMatchOptions {
  /** 洗牌种子，不填就用当前时刻——每次开都是新的一局。 */
  seed?: number
  /** 进答题后隔多久自动交卷，不填走默认的 2.5 秒。 */
  quizDelayMs?: number
}

/**
 * dev 测试房：一个人就能把对局界面整套跑一遍。
 *
 * 座位固定 0（不是热座）：视角跟着行动方跑的话，「我方 / 对方」每次换手都互换，
 * 替对方出牌的入口就没法稳定指向同一边了。
 * 己方用存档里当前那套牌组和确认过的英雄，这样调完牌组能直接进来验；
 * 对手固定平衡预设——测试房是一个人直接开的，没有第二个玩家可问。
 */
export function createTestMatch(platform: Platform, options: LocalMatchOptions = {}): LocalDriver {
  return createLocalDriver({
    seat: 0,
    setup: {
      ...baseSetup(options.seed ?? Date.now()),
      players: [
        { name: '我', deck: currentDeck(platform), ...savedHero(platform) },
        { name: '测试对手', deck: [...BALANCED_DECK] },
      ],
    },
    ...(options.quizDelayMs === undefined ? {} : { quizDelayMs: options.quizDelayMs }),
  })
}

/**
 * 热座：一台机器两个人轮流操作，轮到谁界面就把谁画成「我方」。
 *
 * 两边都用存档里那副牌：这台机器上只有一份存档，也没有第二处可问。
 * 英雄同理，两边一样——想让两边不同得先有选英雄那一步（第 29 条）。
 *
 * 名字按座位号叫「玩家一 / 玩家二」，不叫「先手 / 后手」：第一轮谁先出牌是抛硬币掷出来的，
 * 0 号座不一定先手，而且之后每轮还会交换。
 */
export function createHotSeatMatch(
  platform: Platform,
  options: LocalMatchOptions = {},
): LocalDriver {
  const deck = currentDeck(platform)
  const hero = savedHero(platform)
  return createLocalDriver({
    seat: 'active',
    setup: {
      ...baseSetup(options.seed ?? Date.now()),
      players: [
        { name: '玩家一', deck: [...deck], ...hero },
        { name: '玩家二', deck: [...deck], ...hero },
      ],
    },
    ...(options.quizDelayMs === undefined ? {} : { quizDelayMs: options.quizDelayMs }),
  })
}
