/**
 * 教学对战步骤表的推进判定（搬自黑客松版的 `test/tutorial.test.ts` 的后两段）。
 *
 * 直接跑状态机本体 `pumpTutorial`，不渲染 React——控制器那层只是把它的结果落到 state 上，
 * 而那一层的活（排定时器、订信号）在 node 环境里也跑不起来。
 */

import type { GameEvent } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import type { TutorialSignalContext } from '../src/tutorial/machine'
import { enterTutorialStep, pumpTutorial, signalSatisfied } from '../src/tutorial/machine'
import { TUTORIAL_STEPS, tutorialStep } from '../src/tutorial/steps'
import type { TutorialStepId } from '../src/tutorial/stepTypes'

const PLAYER = 0
const FOE = 1

describe('步骤表本身', () => {
  it('每一步的 next 都指得到人，整张表串成一条链', () => {
    const visited: TutorialStepId[] = []
    let id: TutorialStepId | null = TUTORIAL_STEPS[0]?.id ?? null
    while (id !== null) {
      expect(visited, `${id} 走回头路了`).not.toContain(id)
      visited.push(id)
      id = tutorialStep(id).next
    }
    expect(visited).toHaveLength(TUTORIAL_STEPS.length)
  })

  // 只有终点步才没有推进条件：中间某一步漏写 advance 的话教程会当场冻在那儿，
  // 而界面上看不出任何异常——提示好好地挂着，就是再也不往下走。
  it('除了终点步，每一步都写了推进条件', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.next === null) expect(step.advance).toBeUndefined()
      else expect(step.advance, `${step.id} 没写 advance`).toBeDefined()
    }
  })

  // 推进一律不用 delay（那一档只给 readyOn 等一段没有收尾信号的演出用）：
  // 讲解步骤自己跳页会有人没读完就被翻走。类型上已经排除了，这条守的是「别把类型放宽」。
  it('推进条件里不会出现 delay', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.advance?.kind).not.toBe('delay')
    }
  })
})

describe('步骤表的完成条件判定', () => {
  const context = {
    seenCues: new Set<'quiz-open'>(['quiz-open']),
    elapsedMs: 1200,
    events: [
      { type: 'AI_DEPLOYED', player: 0, ai: { instanceId: 'x', cardId: 'gpt-3-5', owner: 0 } },
    ],
    tapped: false,
    playerSeat: PLAYER,
  } as const

  it('tap 认这批输入里有没有玩家点的那一下', () => {
    expect(signalSatisfied({ kind: 'tap' }, context)).toBe(false)
    expect(signalSatisfied({ kind: 'tap' }, { ...context, tapped: true })).toBe(true)
  })

  it('cue 只认本轮已经出现过的信号', () => {
    expect(signalSatisfied({ kind: 'cue', cue: 'quiz-open' }, context)).toBe(true)
    expect(signalSatisfied({ kind: 'cue', cue: 'quiz-closed' }, context)).toBe(false)
  })

  // delay 只出现在 readyOn 里（等一段没有收尾信号的演出），按进入这一步之后过了多久算。
  it('delay 按进入这一步之后过了多久算', () => {
    expect(signalSatisfied({ kind: 'delay', ms: 1200 }, context)).toBe(true)
    expect(signalSatisfied({ kind: 'delay', ms: 1201 }, context)).toBe(false)
  })

  it('event 认类型，也认是谁干的', () => {
    expect(signalSatisfied({ kind: 'event', event: { type: 'AI_DEPLOYED' } }, context)).toBe(true)
    expect(
      signalSatisfied({ kind: 'event', event: { type: 'AI_DEPLOYED', by: 'me' } }, context),
    ).toBe(true)
    expect(
      signalSatisfied({ kind: 'event', event: { type: 'AI_DEPLOYED', by: 'foe' } }, context),
    ).toBe(false)
    expect(signalSatisfied({ kind: 'event', event: { type: 'GAME_OVER' } }, context)).toBe(false)
  })
})

/**
 * 讲解步骤的推进：全靠玩家点一下（steps.ts 的 `advance: tap()`）。
 */
describe('讲解步骤靠点击推进', () => {
  /** 一批「什么都没发生」的输入，用参数按需覆盖其中一两项。 */
  function inputs(overrides: Partial<TutorialSignalContext> = {}): TutorialSignalContext {
    return {
      seenCues: new Set(),
      elapsedMs: 0,
      events: [],
      tapped: false,
      playerSeat: PLAYER,
      ...overrides,
    }
  }

  it('没点就不动，点了才走下一步', () => {
    // 泵一次让提示出场（这一步没有 readyOn，进入即就绪），但没人点，所以还停在原地。
    const idle = pumpTutorial(enterTutorialStep('TUTORIAL_R2_REFRESH'), inputs())
    expect(idle.ready).toBe(true)
    expect(idle.stepId).toBe('TUTORIAL_R2_REFRESH')

    expect(pumpTutorial(idle, inputs({ tapped: true })).stepId).toBe('TUTORIAL_R2_TOKEN')
  })

  it('一次点击只推一步：连着三步讲解要点三下', () => {
    // 这三步 readyOn 都是空的、进入即就绪，最容易被同一下点击一口气翻完。
    let state = pumpTutorial(enterTutorialStep('TUTORIAL_R2_REFRESH'), inputs())
    const visited = [state.stepId]
    for (let i = 0; i < 3; i += 1) {
      state = pumpTutorial(state, inputs({ tapped: true }))
      visited.push(state.stepId)
    }
    expect(visited).toEqual([
      'TUTORIAL_R2_REFRESH',
      'TUTORIAL_R2_TOKEN',
      'TUTORIAL_R2_DRAW',
      // 第三下之后进入过渡态（放行对手脚本），它等的是引擎事件，不再吃点击。
      'TUTORIAL_R2_FOE_PLAY',
    ])
  })

  it('提示还没出场时点的那一下不算数', () => {
    // R1_STAY 要等上场特效演完（readyOn 里的 delay(1600)）提示才出来。
    const early = pumpTutorial(enterTutorialStep('TUTORIAL_R1_STAY'), inputs({ tapped: true }))
    expect(early.ready).toBe(false)
    expect(early.stepId).toBe('TUTORIAL_R1_STAY')

    // 演出走完，提示出场——刚才那一下没被记着，还停在这一步等玩家重新点。
    const shown = pumpTutorial(early, inputs({ elapsedMs: 1600 }))
    expect(shown.ready).toBe(true)
    expect(shown.stepId).toBe('TUTORIAL_R1_STAY')
    expect(pumpTutorial(shown, inputs({ tapped: true })).stepId).toBe('TUTORIAL_R1_END_PLAY')
  })

  it('第 1 轮对手最后一张牌落场后，必须再点一下才放行答题', () => {
    const deployed: GameEvent = {
      type: 'AI_DEPLOYED',
      player: FOE,
      ai: { instanceId: 'foe-ai', cardId: 'gpt-4o', owner: FOE },
    }
    const paused = pumpTutorial(
      enterTutorialStep('TUTORIAL_R1_FOE_PLAY'),
      inputs({ events: [deployed] }),
    )

    expect(paused.ready).toBe(true)
    expect(paused.stepId).toBe('TUTORIAL_R1_FOE_DONE')
    expect(pumpTutorial(paused, inputs()).stepId).toBe('TUTORIAL_R1_FOE_DONE')
    expect(pumpTutorial(paused, inputs({ tapped: true })).stepId).toBe('TUTORIAL_R1_ANSWER')
  })

  it('要玩家出牌的步骤不吃点击，只认引擎事件', () => {
    const state = pumpTutorial(enterTutorialStep('TUTORIAL_R1_PLAY_AI'), inputs({ tapped: true }))
    expect(state.stepId).toBe('TUTORIAL_R1_PLAY_AI')
    const played = pumpTutorial(
      state,
      inputs({
        events: [
          {
            type: 'AI_DEPLOYED',
            player: PLAYER,
            ai: { instanceId: 'x', cardId: 'gpt-3-5', owner: PLAYER },
          },
        ],
      }),
    )
    expect(played.stepId).toBe('TUTORIAL_R1_STAY')
  })

  // 第 3 轮开局那几条信号（补牌、横幅）早在教程还念着第 2 轮结算时就演完了。
  // 认不出「已经发生过」的话，教程会卡在那儿等一条永远不会再来的信号。
  it('已经过去的舞台信号照样算数', () => {
    const state = pumpTutorial(
      enterTutorialStep('TUTORIAL_R3_FREE_PLAY'),
      inputs({ seenCues: new Set(['deal-done', 'round-banner-done']) }),
    )
    expect(state.ready).toBe(true)
    expect(state.stepId).toBe('TUTORIAL_R3_FREE_PLAY')
  })
})
