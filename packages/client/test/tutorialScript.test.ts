/**
 * 教学对战的剧本对账（搬自黑客松版的 `test/tutorial.test.ts` 的前半）。
 *
 * 这里只测 driver 那一层（引擎 + 对手脚本 + 真实模型回答表），不碰界面：
 * 教程「可预测」这件事全靠这三样，把它们钉住，引导层就只剩排版问题。
 * 共用的脚手架在 test/helpers/tutorialRun.ts。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TUTORIAL_CARDS, tutorialCardCost } from '../src/tutorial/content'
import {
  confirmRound,
  endPlay,
  FOE,
  flush,
  foeAiId,
  PLAYER,
  play,
  playThroughRoundOne,
  scoredEvents,
  start,
  stateOf,
} from './helpers/tutorialRun'

describe('教学对战剧本', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('主线：三轮都归玩家，3:0 拿下', () => {
    const run = start()
    playThroughRoundOne(run)

    // 第 2 轮由对手先手，它已经把 deepseek-r1 派上场了，玩家的干扰技能才有目标。
    expect(stateOf(run.driver).round).toBe(2)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['deepseek-r1'])
    // 这一轮只打技能牌：教程不放行增派 AI（见 TUTORIAL_CARDS.optionalAi）。
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    // 第 3 轮回到玩家先手，随便派一张都不影响结果。
    expect(stateOf(run.driver).round).toBe(3)
    play(run.driver, 'gemini')
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    // 三轮都是「只有一方答对」：第 1 轮和第 3 轮对手自己答错，第 2 轮是被复读机干扰答错。
    // 这三条对错全部来自那张真实模型回答表，不是教学局自己写死的（见 tutorial/content.ts）。
    //「答对数相同才比 Token」那一档在教学局里刻意不出现，所以三条都该是 more-correct。
    const scored = scoredEvents(run.events)
    expect(scored.map((event) => event.verdict)).toEqual([
      'more-correct',
      'more-correct',
      'more-correct',
    ])
    expect(scored.map((event) => event.scores)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ])
    expect(run.events.filter((event) => event.type === 'GAME_OVER')).toEqual([
      { type: 'GAME_OVER', winner: PLAYER },
    ])
  })

  // 第 2 轮那一课的全部内容：复读机命中之后，对手那张 AI 真的只会答「香蕉」并判错。
  // 这条断言直接盯着揭晓出来的那句话，卡面写的和玩家看到的对不上时会当场红。
  it('第 2 轮：被复读机干扰的对手 AI 只答「香蕉」，判错后被罚下', () => {
    const run = start()
    playThroughRoundOne(run)
    const foeAi = foeAiId(run.driver)
    play(run.driver, TUTORIAL_CARDS.skill, foeAi)
    endPlay(run.driver)
    flush()

    const answered = run.events.filter(
      (event) => event.type === 'AI_ANSWERED' && event.instanceId === foeAi,
    )
    expect(answered).toHaveLength(1)
    expect(answered[0]).toMatchObject({ correct: false, answer: '香蕉' })
    // 答错就罚下，所以第 3 轮对手场上只剩它新派的那一张。
    expect(run.events).toContainEqual({ type: 'AI_ELIMINATED', instanceId: foeAi, owner: FOE })

    const round2 = scoredEvents(run.events)[1]
    expect(round2?.verdict).toBe('more-correct')
    expect(round2?.correctCounts).toEqual([1, 0])
    // 只花了复读机那 4 点，对手 3 点——这一分和消耗无关，但数字仍旧记在事件里。
    expect(round2?.spent).toEqual([
      tutorialCardCost(TUTORIAL_CARDS.skill),
      tutorialCardCost('deepseek-r1'),
    ])
    expect(round2?.scores).toEqual([2, 0])
  })

  it('挡住对手脚本：放行之前它一张牌都不出', () => {
    const run = start()
    flush()
    // 教程在讲提示的时候会把对手挡下来（第 2 轮对手先手，不挡的话它的出牌演出会盖住引导）。
    run.driver.setFoeHold(true)
    play(run.driver, TUTORIAL_CARDS.firstAi)
    endPlay(run.driver)
    flush()
    expect(stateOf(run.driver).players[FOE].board).toEqual([])
    expect(stateOf(run.driver).phase).toBe('play')

    run.driver.setFoeHold(false)
    flush()
    // 放行之后它把整轮补完：出牌 → 结束出牌 → 答题 → 它自己那下结算确认。
    // 玩家那下确认还没点，所以局面停在结算阶段等着。
    expect(stateOf(run.driver).phase).toBe('settle')
    expect(stateOf(run.driver).settleConfirmed).toEqual([false, true])
    confirmRound(run.driver)
    flush()
    // 双方都确认了才进第 2 轮，对手又先手派出那张要被复读机干扰的 AI。
    expect(stateOf(run.driver).round).toBe(2)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['deepseek-r1'])
  })

  it('第 1 轮对手最后一张牌落场后可以暂停，玩家确认后才进入答题', () => {
    // 教程控制器收到对手落场事件时，会同步关上这道闸并显示确认提示。
    const run: ReturnType<typeof start> = start((events) => {
      if (events.some((event) => event.type === 'AI_DEPLOYED' && event.player === FOE)) {
        run.driver.setFoeHold(true)
      }
    })

    flush()
    play(run.driver, TUTORIAL_CARDS.firstAi)
    endPlay(run.driver)
    flush()

    expect(stateOf(run.driver).phase).toBe('play')
    expect(stateOf(run.driver).activePlayer).toBe(FOE)
    expect(stateOf(run.driver).players[FOE].board.map((ai) => ai.cardId)).toEqual(['gpt-4o'])
    expect(run.events.some((event) => event.type === 'QUESTION_REVEALED')).toBe(false)

    // 玩家点完提示后，控制器重新放开脚本；对手结束出牌，答题才真正开始。
    run.driver.setFoeHold(false)
    flush()
    expect(run.events.some((event) => event.type === 'QUESTION_REVEALED')).toBe(true)
    expect(stateOf(run.driver).phase).toBe('settle')
  })

  it('第 3 轮什么都不打直接结束：场上的老 AI 照样答对，3:0 收场', () => {
    const run = start()
    playThroughRoundOne(run)
    play(run.driver, TUTORIAL_CARDS.skill, foeAiId(run.driver))
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    expect(stateOf(run.driver).round).toBe(3)
    endPlay(run.driver)
    flush()
    confirmRound(run.driver)
    flush()

    const scored = scoredEvents(run.events)
    expect(scored[2]?.verdict).toBe('more-correct')
    expect(scored[2]?.scores).toEqual([3, 0])
    expect(stateOf(run.driver).winner).toBe(PLAYER)
  })
})
