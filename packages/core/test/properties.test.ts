/**
 * fast-check 属性测试：随机合法指令序列打几千局，每局逐步检查《正式版架构》6.3 列的不变量。
 *
 * 每条不变量单独一个 property，坏了一眼就知道坏的是哪一条。
 * 走局器（test/helpers/randomPlay.ts）按整数种子决定牌组、英雄和每一步的选择，
 * 所以 fast-check 报出来的反例就是一个种子，复现方法见 test/README.md。
 *
 * 确定性相关的两条（同 seed 同结果、状态 JSON 往返）在 properties.determinism.test.ts。
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { GameEvent, GameState, PlayerId } from '../src/index'
import { WIN_TARGET } from '../src/index'
import { playRandomGame, type RandomPlay } from './helpers/randomPlay'

/**
 * 每条不变量跑多少局。整个文件本机 30 秒内跑完是硬要求（见 test/README.md），
 * 一局随机走完大约 1 毫秒，所以这个数还有很大余量。
 */
/**
 * 每条属性的超时。一条属性要打上千局，本机 4~6 秒，vitest 默认的 5 秒在整包并行、
 * CI 慢机器上都会被挤过线；这里放到 60 秒，只防死循环，不当性能门禁。
 */
const PROPERTY_TIMEOUT_MS = 60_000

const NUM_RUNS = 1000

/**
 * 混进非法指令的比例：四分之一的步子发一条保证会被拒的指令。
 *
 * 不设成 0.5 是因为非法指令不推进局面，比例越高每局要走的步数越多；
 * 四分之一已经让每局平均撞上 10 条上下被拒的指令（一局平均 42 步），
 * 足够把"被拒之后状态没变"覆盖到各个阶段。
 */
const ILLEGAL_RATE = 0.25

const SEED = fc.integer({ min: 1, max: 0x7fffffff })
const SEATS: PlayerId[] = [0, 1]

/** 把一局的开局事件和每一步的事件按发生顺序摊平。 */
function allEvents(play: RandomPlay): GameEvent[] {
  return [...play.initialEvents, ...play.steps.flatMap((step) => step.events)]
}

/** 一份状态里出现过的全部卡牌实例 id（牌堆、手牌、场上、弃牌堆）。 */
function instanceIds(state: GameState): string[] {
  return state.players.flatMap((p) => [
    ...p.deck.map((c) => c.instanceId),
    ...p.hand.map((c) => c.instanceId),
    ...p.board.map((a) => a.instanceId),
    ...p.discard.map((c) => c.instanceId),
  ])
}

/** 断言失败时把种子和出问题的那一步写进消息里，反例照着它复现。 */
function fail(seed: number, stepIndex: number, message: string): never {
  throw new Error(`seed=${seed} 第 ${stepIndex} 步：${message}`)
}

describe('属性测试：随机合法指令序列打完整局', () => {
  it(
    '每一步之后双方 Token 都不为负，也不超过本轮上限',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const play = playRandomGame(seed, { illegalRate: ILLEGAL_RATE })
          // 「模型蒸馏」把弃掉的 AI 牌按印刷费用换成 Token，这一笔是**有意允许**顶破上限的
          //（见 engine.ts 的 model-distillation 分支），多出来的部分要等进下一轮补满时才被覆盖。
          // 所以上限那半边要放过"本轮蒸馏过"的一方，只有下限是无条件的。
          const distilled = [false, false]
          play.steps.forEach((step, index) => {
            for (const event of step.events) {
              if (event.type === 'ROUND_STARTED') {
                distilled[0] = false
                distilled[1] = false
              }
              // 走局器不发 DEBUG_REMOVE_CARD，所以这条事件只可能来自「模型蒸馏」。
              if (event.type === 'CARD_REMOVED') distilled[event.player] = true
            }
            for (const seat of SEATS) {
              const player = step.state.players[seat]
              if (player.tokens < 0) fail(seed, index, `${seat} 号玩家 Token 变成了负数`)
              if (!distilled[seat] && player.tokens > player.tokenMax) {
                fail(
                  seed,
                  index,
                  `${seat} 号玩家 Token ${player.tokens} 超过上限 ${player.tokenMax}`,
                )
              }
              if (player.spentThisRound < 0) fail(seed, index, `${seat} 号玩家本轮消耗为负`)
            }
          })
        }),
        { numRuns: NUM_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    '手牌张数对得上账，双方的牌一张不多一张不少',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const play = playRandomGame(seed, { illegalRate: ILLEGAL_RATE })
          // 引擎里没有手牌上限常量，所以这里查的是账：手上剩几张 = 抽到的 − 打出的 − 被弃的。
          // 每张牌离开手牌都恰好发一条事件（AI 牌 AI_DEPLOYED、技能牌 SKILL_PLAYED、
          // 被「模型蒸馏」弃掉的 CARD_REMOVED），漏发一条这里就对不上。
          const drawn = [0, 0]
          const left = [0, 0]
          const deckSize = play.setup.players.map((side) => side.deck.length)
          const check = (events: GameEvent[], state: GameState, index: number): void => {
            for (const event of events) {
              if (event.type === 'CARD_DRAWN') drawn[event.player] = drawn[event.player]! + 1
              if (event.type === 'AI_DEPLOYED') left[event.player] = left[event.player]! + 1
              if (event.type === 'SKILL_PLAYED') left[event.player] = left[event.player]! + 1
              if (event.type === 'CARD_REMOVED') left[event.player] = left[event.player]! + 1
            }
            for (const seat of SEATS) {
              const player = state.players[seat]
              const expected = drawn[seat]! - left[seat]!
              if (player.hand.length !== expected) {
                fail(
                  seed,
                  index,
                  `${seat} 号玩家手上 ${player.hand.length} 张，按账应该是 ${expected} 张`,
                )
              }
              // 牌只在四个区之间搬家，谁也不会凭空多出来或消失（调试指令造牌除外，走局器不发）。
              const total =
                player.deck.length +
                player.hand.length +
                player.board.length +
                player.discard.length
              if (total !== deckSize[seat]) {
                fail(
                  seed,
                  index,
                  `${seat} 号玩家四个区加起来 ${total} 张，牌组是 ${deckSize[seat]} 张`,
                )
              }
            }
          }
          check(play.initialEvents, play.initialState, -1)
          play.steps.forEach((step, index) => {
            check(step.events, step.state, index)
          })
        }),
        { numRuns: NUM_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    '非法指令只回一条 COMMAND_REJECTED，状态一个字节都不变',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const play = playRandomGame(seed, { illegalRate: ILLEGAL_RATE })
          let before = JSON.stringify(play.initialState)
          play.steps.forEach((step, index) => {
            const after = JSON.stringify(step.state)
            const rejected = step.events.some((e) => e.type === 'COMMAND_REJECTED')
            if (step.illegal) {
              if (!rejected) fail(seed, index, `非法指令没被拒：${JSON.stringify(step.command)}`)
              if (step.events.length !== 1) fail(seed, index, '被拒的指令还产生了别的事件')
              if (after !== before) fail(seed, index, '被拒的指令改动了状态')
            } else if (rejected) {
              // 走局器只从"当前合法"的池子里挑，被拒说明引擎的校验和走局器
              // （test/helpers/commandPool.ts）对不上了，先看哪边过时。
              const reason = step.events.find((e) => e.type === 'COMMAND_REJECTED')
              fail(
                seed,
                index,
                `合法指令被拒：${JSON.stringify(step.command)} → ${JSON.stringify(reason)}`,
              )
            }
            before = after
          })
        }),
        { numRuns: NUM_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    '同一时刻场上和手牌里的 instanceId 全局唯一',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const play = playRandomGame(seed, { illegalRate: ILLEGAL_RATE })
          const check = (state: GameState, index: number): void => {
            const seen = new Set<string>()
            for (const id of instanceIds(state)) {
              if (seen.has(id)) fail(seed, index, `实例 id 撞车：${id}`)
              seen.add(id)
            }
          }
          check(play.initialState, -1)
          play.steps.forEach((step, index) => {
            check(step.state, index)
          })
        }),
        { numRuns: NUM_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    '打完的局一定有赢家，收场理由只有"分数到线"和"题库出完"两种',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const play = playRandomGame(seed, { illegalRate: ILLEGAL_RATE })
          if (play.exhausted) {
            throw new Error(`seed=${seed} 撞上步数上限还没打完，${play.steps.length} 步`)
          }
          const final = play.final
          expect(final.phase).toBe('finished')
          expect(final.winner).not.toBeNull()
          const scores = [final.players[0].score, final.players[1].score]
          // 收场两条路（见 engine.ts 的 confirmRound）：有人**单独**到 WIN_TARGET 分，
          // 或者题库出完了保底判一次。两条都不成立就说明结束条件被改坏了。
          const decided =
            (scores[0]! >= WIN_TARGET || scores[1]! >= WIN_TARGET) && scores[0] !== scores[1]
          const exhaustedQuestions = final.round >= final.totalRounds
          if (!decided && !exhaustedQuestions) {
            throw new Error(`seed=${seed} 打完了但两条收场理由都不成立：比分 ${scores.join(':')}`)
          }
          // 'draw' 只可能来自"题库出完还同分"那一路。
          if (final.winner === 'draw') {
            expect(scores[0]).toBe(scores[1])
            expect(exhaustedQuestions).toBe(true)
          } else if (final.winner !== null) {
            const loser: PlayerId = final.winner === 0 ? 1 : 0
            expect(scores[final.winner]!).toBeGreaterThan(scores[loser]!)
          }
          // 事件流最后一条一定是 GAME_OVER，客户端靠它收尾。
          const events = allEvents(play)
          expect(events[events.length - 1]).toEqual({ type: 'GAME_OVER', winner: final.winner })
        }),
        { numRuns: NUM_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )
})
