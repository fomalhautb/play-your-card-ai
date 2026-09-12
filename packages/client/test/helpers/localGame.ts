/**
 * 单机 driver 两份测试共用的脚手架：一份定死的开局配置，加一台假时钟。
 *
 * 假时钟是这里的要紧东西：答题自动交卷默认要等 2.5 秒，真等的话每个用例都得挂两秒半，
 * 而这一层的时序恰恰是最该测的部分（见 src/match/quizAutopilot.ts 的注入口）。
 */

import { createCatalog, PRESET_DECKS, QUESTION_POOL } from '@ai-duel/content'
import type { GameSetup } from '@ai-duel/core'
import type { AutopilotTimers } from '../../src/match/quizAutopilot'

/** 一台手推的定时器。到点由用例自己调 `tick`，谁都不用真的等。 */
export interface FakeClock extends AutopilotTimers {
  /** 推进这么多毫秒，把到期的回调按到期顺序跑掉。 */
  tick(ms: number): void
  /** 还挂着几个没到点的定时器。`dispose` 有没有清干净靠它验。 */
  pending(): number
}

export function createFakeClock(): FakeClock {
  interface Entry {
    id: number
    at: number
    handler: () => void
  }
  let now = 0
  let nextId = 1
  let entries: Entry[] = []
  return {
    setTimeout(handler, ms) {
      const id = nextId
      nextId += 1
      entries.push({ id, at: now + ms, handler })
      return id
    },
    clearTimeout(id) {
      entries = entries.filter((entry) => entry.id !== id)
    },
    tick(ms) {
      now += ms
      // 先摘出来再跑：回调里可能又排新的定时器，边遍历边改数组会漏掉或重复。
      const due = entries.filter((entry) => entry.at <= now).sort((a, b) => a.at - b.at)
      entries = entries.filter((entry) => entry.at > now)
      for (const entry of due) entry.handler()
    },
    pending: () => entries.length,
  }
}

/**
 * 一局固定的对战。
 *
 * 种子固定：同一个种子 + 同一副牌永远得到同一局，测试不会因为洗牌不同而飘。
 * 先手也一并定死（`firstPlayer: 0`），否则「轮到谁出牌」这条断言会随种子摇摆。
 * 两边都不带英雄：英雄技能不是这两份测试要问的事，带上反而多一份会变的数值
 *（阿达的第一算法开局就把 Token 上限加了 2）。
 */
export function localSetup(): GameSetup {
  return {
    seed: 20260921,
    catalog: createCatalog(),
    questionPool: QUESTION_POOL,
    firstPlayer: 0,
    players: [
      { name: '甲', deck: [...PRESET_DECKS[0]!], hero: null },
      { name: '乙', deck: [...PRESET_DECKS[1]!], hero: null },
    ],
  }
}
