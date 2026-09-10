/**
 * 答题自动交卷的时序：什么时候排定时器、到点读哪一份局面、什么时候不该发。
 *
 * 这几条全是时序问题，而时序正是旧版一条测试都没有的地方（那边的定时器直接挂在
 * 全局 setTimeout 上）。这里靠注入的假时钟一步步推，两秒半一次都不用真等。
 */

import type { Command, GameState } from '@ai-duel/core'
import { createGame } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import { createLocalDriver } from '../src/match/localDriver'
import { createQuizAutopilot, QUIZ_AUTOPILOT_DELAY_MS } from '../src/match/quizAutopilot'
import { createFakeClock, localSetup } from './helpers/localGame'

function open() {
  const timers = createFakeClock()
  const driver = createLocalDriver({ seat: 0, setup: localSetup(), timers })
  return { driver, timers }
}

/** 把这一局推进到答题阶段。 */
function toQuiz(driver: ReturnType<typeof open>['driver']): void {
  driver.debug({ type: 'DEBUG_SKIP_TO_QUIZ' })
}

describe('自动交卷', () => {
  it('进答题才排定时器，到点提交结果', () => {
    const { driver, timers } = open()
    expect(timers.pending()).toBe(0)
    toQuiz(driver)
    expect(timers.pending()).toBe(1)

    // 差一毫秒都不该动。
    timers.tick(QUIZ_AUTOPILOT_DELAY_MS - 1)
    expect(driver.getSnapshot().view?.phase).toBe('quiz')

    timers.tick(1)
    // 交完卷本轮就算完了，引擎进结算等双方确认。
    expect(driver.getSnapshot().view?.phase).toBe('settle')
  })

  it('只在「非 quiz → quiz」这个变化沿排一次', () => {
    const { driver, timers } = open()
    toQuiz(driver)
    expect(timers.pending()).toBe(1)
    // 答题阶段里测试面板照样能造牌，每条都排一个的话同一轮会被交好几次卷。
    driver.debug({ type: 'DEBUG_ADD_CARD', player: 0 })
    driver.debug({ type: 'DEBUG_ADD_CARD', player: 1 })
    expect(timers.pending()).toBe(1)
  })

  it('到点时局面已经不在答题阶段就什么都不做', () => {
    /*
     * 这一条直接测自动驾驶本身，不经 driver：要构造的正是「排了定时器、到点前局面
     * 已经离开答题阶段」那一瞬，而经 driver 的话唯一能离开答题阶段的路就是交卷本身。
     */
    const timers = createFakeClock()
    const opening = createGame(localSetup())
    let state: GameState = opening.state
    const sent: Command[] = []
    const autopilot = createQuizAutopilot({
      getState: () => state,
      apply: (command) => sent.push(command),
      timers,
    })

    state = { ...state, phase: 'quiz' }
    autopilot.observe(state)
    expect(timers.pending()).toBe(1)
    // 到点前局面被别人推走了（测试面板手动推进过就是这样）。
    state = { ...state, phase: 'settle' }
    timers.tick(QUIZ_AUTOPILOT_DELAY_MS)
    expect(sent).toHaveLength(0)
  })

  it('到点读的是最新那份局面，不是排定时器那一刻的快照', () => {
    const timers = createFakeClock()
    const opening = createGame(localSetup())
    let state: GameState = { ...opening.state, phase: 'quiz' }
    const sent: Command[] = []
    const autopilot = createQuizAutopilot({
      getState: () => state,
      apply: (command) => sent.push(command),
      timers,
      // 结果从哪来不是这一条要问的事，给一份最省的：这里只看名单里有谁。
      answersFor: (_question, aiUnits) =>
        aiUnits.map((ai) => ({
          instanceId: ai.instanceId,
          correct: true,
          answer: '',
          reasoning: '',
        })),
    })
    autopilot.observe(state)

    // 排完定时器之后场上多了一个单位：交卷时它必须也在名单里。
    const extra = {
      instanceId: 'later-1',
      cardId: opening.state.players[0].deck[0]!.cardId,
      owner: 0 as const,
    }
    const players = [...opening.state.players] as GameState['players']
    players[0] = { ...players[0], board: [extra] }
    state = { ...state, players }

    timers.tick(QUIZ_AUTOPILOT_DELAY_MS)
    const submitted = sent[0]
    expect(submitted?.type).toBe('SUBMIT_ANSWERS')
    if (submitted?.type !== 'SUBMIT_ANSWERS') throw new Error('第一条指令应当是交卷')
    expect(submitted.results.map((one) => one.instanceId)).toEqual(['later-1'])
  })

  it('dispose 清掉还没到点的定时器', () => {
    const { driver, timers } = open()
    toQuiz(driver)
    expect(timers.pending()).toBe(1)
    driver.dispose()
    expect(timers.pending()).toBe(0)
  })

  it('每一轮各排一次', () => {
    const { driver, timers } = open()
    toQuiz(driver)
    timers.tick(QUIZ_AUTOPILOT_DELAY_MS)
    expect(driver.getSnapshot().view?.phase).toBe('settle')

    // 双方确认进下一轮，再跳一次答题，定时器要重新排上。
    driver.send({ type: 'CONFIRM_ROUND', player: 0 })
    driver.send({ type: 'CONFIRM_ROUND', player: 1 })
    expect(driver.getSnapshot().view?.round).toBe(2)
    toQuiz(driver)
    expect(timers.pending()).toBe(1)
    timers.tick(QUIZ_AUTOPILOT_DELAY_MS)
    expect(driver.getSnapshot().view?.phase).toBe('settle')
  })

  it('自己交的卷会走 answersFor 那条口子', () => {
    const timers = createFakeClock()
    let asked = 0
    const driver = createLocalDriver({
      seat: 0,
      setup: localSetup(),
      timers,
      // 教程（第 32 条）要把每一轮的对错写死，走的就是这个参数。
      answersFor: (_question, aiUnits) => {
        asked += 1
        return aiUnits.map((ai) => ({
          instanceId: ai.instanceId,
          correct: true,
          answer: '写死的答案',
          reasoning: '写死的理由',
        }))
      },
    })
    driver.debug({ type: 'DEBUG_SKIP_TO_QUIZ' })
    timers.tick(QUIZ_AUTOPILOT_DELAY_MS)
    expect(asked).toBe(1)
    expect(driver.getSnapshot().view?.phase).toBe('settle')
  })
})
