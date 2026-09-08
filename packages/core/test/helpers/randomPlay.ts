/**
 * 随机走局器：给一个种子，从开局一路随机挑合法指令打到分出胜负。
 *
 * 属性测试（properties*.test.ts）和 golden 录制（golden/record.ts）用的是同一个走局器，
 * 所以 golden 里那几局就是属性测试跑过成千上万局里的几局，两边不会各走各的路。
 *
 * 随机源是 pure-rand 而不是 fast-check：走局器要能脱离 fast-check 单独跑（录 golden 时就是），
 * 而且"一个整数种子 = 一整局"这件事让 fast-check 报出来的反例只有一个数字，复现最省事。
 */

import { BALANCED_DECK, HIGH_COST_DECK, LOW_COST_DECK, scriptedAnswers } from '@ai-duel/content'
import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import type { CardId, Command, GameEvent, GameState, HeroId } from '../../src/index'
import { execute } from '../../src/index'
import { boardUnits, currentQuestion, illegalCommands, legalCommands } from './commandPool'
import { ALL_QUESTION_IDS, COVERAGE_DECK, type PlaySetup, startGame } from './gameSetup'

/** 随机开局能挑到的牌组：三副预设，加一副专门覆盖预设够不到的那 4 张牌。 */
const DECK_CHOICES: readonly CardId[][] = [
  BALANCED_DECK,
  LOW_COST_DECK,
  HIGH_COST_DECK,
  COVERAGE_DECK,
]

/** 随机开局能挑到的英雄：4 位已实装的，外加"不带英雄"。 */
const HERO_CHOICES: readonly (HeroId | null)[] = [
  'danqi-chen',
  'melanie-perkins',
  'ada-lovelace',
  'grace-hopper',
  null,
]

interface PlayStep {
  command: Command
  events: GameEvent[]
  /** 这条是走局器故意混进来的非法指令（引擎必须原样退回状态）。 */
  illegal: boolean
  /** 执行完这条指令之后的状态。上一步的 `state` 就是这一步执行前的状态。 */
  state: GameState
}

export interface RandomPlay {
  setup: PlaySetup
  /** createGame 产生的开局事件。 */
  initialEvents: GameEvent[]
  initialState: GameState
  steps: PlayStep[]
  /** 最后一步之后的状态（正常走完就是 phase === 'finished'）。 */
  final: GameState
  /** 撞上步数上限还没打完。正常一局到不了这里，撞上多半是规则出了环。 */
  exhausted: boolean
}

export interface RandomPlayOptions {
  /**
   * 混进非法指令的比例，0~1。非法指令不推进局面，只用来查"被拒之后状态一个字节都没变"。
   * 默认 0（录 golden 时要的就是一串干净的合法指令）。
   */
  illegalRate?: number
  /** 步数上限，防止规则出 bug 时死循环。8 道题 8 轮，正常一局远用不到默认值。 */
  maxSteps?: number
  /** 指定开局，不填就按 seed 随机挑牌组和英雄。 */
  setup?: PlaySetup
}

/** 从数组里等概率挑一个。 */
function pick<T>(items: readonly T[], rng: RandomGenerator): T {
  return items[uniformInt(rng, 0, items.length - 1)]!
}

/** 本轮全场答题结果，和真对局里房主/本地 driver 发的是同一条。 */
function answersFor(state: GameState): Command {
  return {
    type: 'SUBMIT_ANSWERS',
    results: scriptedAnswers(currentQuestion(state), boardUnits(state)),
  }
}

/** 按种子随机挑一副开局：两副牌组、两位英雄、先手由 seed 抛硬币定。 */
function randomSetup(seed: number, rng: RandomGenerator): PlaySetup {
  return {
    seed,
    players: [
      { name: '玩家一', deck: pick(DECK_CHOICES, rng).slice(), hero: pick(HERO_CHOICES, rng) },
      { name: '玩家二', deck: pick(DECK_CHOICES, rng).slice(), hero: pick(HERO_CHOICES, rng) },
    ],
    questionIds: ALL_QUESTION_IDS,
  }
}

/**
 * 打一整局。
 *
 * 复现某一次结果只要同一个 seed 和同一份 options——走局器自己不碰 Math.random 和时钟。
 */
export function playRandomGame(seed: number, options: RandomPlayOptions = {}): RandomPlay {
  const rng = mersenne(seed)
  // 开局描述先取：没传 setup 时它要消耗 rng，位置换了整局都不一样。
  const setup = options.setup ?? randomSetup(seed, rng)
  const illegalRate = options.illegalRate ?? 0
  const maxSteps = options.maxSteps ?? 800

  const started = startGame(setup)
  const steps: PlayStep[] = []
  let state = started.state
  while (state.phase !== 'finished' && steps.length < maxSteps) {
    // 先掷"这一步要不要发非法指令"再挑指令：两条路都只消耗一次 rng，
    // 换个比例重跑时前面的走法不会整体错位。
    const illegal = uniformInt(rng, 1, 1000) <= Math.round(illegalRate * 1000)
    // 两个池子都保证非空：出牌阶段永远有 END_PLAY，答题和结算各自至少一条，
    // 非法那边的头两条（不存在的卡牌 id、不存在的手牌实例）任何阶段都成立。
    const command = pick(illegal ? illegalCommands(state) : legalCommands(state, answersFor), rng)
    const result = execute(state, command)
    steps.push({ command, events: result.events, illegal, state: result.state })
    state = result.state
  }
  return {
    setup,
    initialEvents: started.events,
    initialState: started.state,
    steps,
    final: state,
    exhausted: state.phase !== 'finished',
  }
}
