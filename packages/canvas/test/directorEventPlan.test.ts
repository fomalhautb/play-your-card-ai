/**
 * 事件覆盖（《正式版架构》6.5 第 2 条）：每种事件类型要么有演出，要么显式声明忽略，漏掉的挂。
 *
 * 两层守：
 * 1. `EVENT_PLAN` 是 `Record<GameEvent['type'], …>`，core 加一种事件时它编译不过；
 * 2. 下面这张样例表同样是 `Record`，每种事件都要给一个能真正跑起来的最小事件批，
 *    标了「有演出」的必须真的产出 cue，标了「不演」的必须一条都不产出。
 *    光有第 1 层不够——那只能保证有人写过一行字，保证不了那行字和代码对得上。
 */

import type { GameEvent, PlayerView } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import { EVENT_PLAN } from '../src/index'
import {
  aiAnswered,
  aiDeployed,
  answeredQuestion,
  cardDrawn,
  makeDirector,
  makeView,
  questionRevealed,
  roundScored,
  skillCanceled,
  skillPlayed,
} from './helpers/directorFixtures'

interface Batch {
  events: GameEvent[]
  view: PlayerView
}

interface Sample {
  /** 先喂这几批把前提摆好（比如结算层得先立起来才收得下答题结果）。 */
  before: Batch[]
  /** 真正要考察的那一批，只放被考察的那一条事件。 */
  batch: Batch
}

const PLAY_VIEW = makeView()
const QUIZ_VIEW = makeView({ phase: 'quiz' })
const SETTLE_VIEW = makeView({ phase: 'settle', questions: [answeredQuestion()] })

/** 结算层已经立起来，并且收过一条答题结果。 */
const SETTLE_OPEN: Batch[] = [
  { events: [questionRevealed()], view: QUIZ_VIEW },
  { events: [aiAnswered(0, 'p0-a', false)], view: QUIZ_VIEW },
]

const SAMPLES: Record<GameEvent['type'], Sample> = {
  GAME_STARTED: {
    before: [],
    batch: { events: [{ type: 'GAME_STARTED', firstPlayer: 0 }], view: PLAY_VIEW },
  },
  CARD_DRAWN: { before: [], batch: { events: [cardDrawn(0)], view: PLAY_VIEW } },
  CARD_REMOVED: {
    before: [],
    batch: {
      events: [{ type: 'CARD_REMOVED', player: 0, instanceId: 'p0-a' }],
      view: PLAY_VIEW,
    },
  },
  ROUND_STARTED: {
    before: [],
    batch: {
      events: [{ type: 'ROUND_STARTED', round: 2, firstPlayer: 0, category: 'life', keywords: [] }],
      view: PLAY_VIEW,
    },
  },
  PLAY_TURN_STARTED: {
    before: [],
    batch: { events: [{ type: 'PLAY_TURN_STARTED', player: 0 }], view: PLAY_VIEW },
  },
  AI_DEPLOYED: { before: [], batch: { events: [aiDeployed(0, 'p0-a')], view: PLAY_VIEW } },
  SKILL_PLAYED: { before: [], batch: { events: [skillPlayed(0, 'p0-s')], view: PLAY_VIEW } },
  SKILL_CANCELED: { before: [], batch: { events: [skillCanceled(0, 'p0-s')], view: PLAY_VIEW } },
  HERO_SKILL_USED: {
    before: [],
    batch: {
      events: [
        {
          type: 'HERO_SKILL_USED',
          player: 0,
          heroId: 'danqi-chen',
          targetInstanceId: 'p0-a',
          fromCardId: 'gpt-3-5',
          toCardId: 'gpt-4o',
          direction: 'upgrade',
        },
      ],
      view: PLAY_VIEW,
    },
  },
  QUESTION_REVEALED: {
    before: [],
    batch: { events: [questionRevealed()], view: QUIZ_VIEW },
  },
  AI_ANSWERED: {
    before: [SETTLE_OPEN[0]!],
    batch: { events: [aiAnswered(0, 'p0-a', true)], view: QUIZ_VIEW },
  },
  AI_ELIMINATED: {
    before: SETTLE_OPEN,
    batch: {
      events: [{ type: 'AI_ELIMINATED', instanceId: 'p0-a', owner: 0 }],
      view: QUIZ_VIEW,
    },
  },
  AI_SAFE_PASSED: {
    before: SETTLE_OPEN,
    // 保送本身没有当场的演出，它要等主线盖判定章那一拍才看得见，所以带上计分一起喂。
    batch: {
      events: [{ type: 'AI_SAFE_PASSED', instanceId: 'p0-a', owner: 0 }, roundScored()],
      view: SETTLE_VIEW,
    },
  },
  AI_REMOVED: {
    before: [],
    batch: {
      events: [
        {
          type: 'AI_REMOVED',
          instanceId: 'p1-a',
          owner: 1,
          cardId: 'doubao',
          by: 'memory-shortage',
        },
      ],
      view: PLAY_VIEW,
    },
  },
  AI_TRANSFORMED: {
    before: [],
    batch: {
      events: [
        {
          type: 'AI_TRANSFORMED',
          instanceId: 'p0-a',
          owner: 0,
          fromCardId: 'gpt-3-5',
          toCardId: 'gpt-4o',
        },
      ],
      view: PLAY_VIEW,
    },
  },
  ROUND_SCORED: {
    before: SETTLE_OPEN,
    batch: { events: [roundScored()], view: SETTLE_VIEW },
  },
  ROUND_CONFIRMED: {
    before: [],
    batch: { events: [{ type: 'ROUND_CONFIRMED', player: 1 }], view: PLAY_VIEW },
  },
  GAME_OVER: {
    before: [],
    batch: {
      events: [{ type: 'GAME_OVER', winner: 0 }],
      view: makeView({ phase: 'finished', winner: 0 }),
    },
  },
  COMMAND_REJECTED: {
    before: [],
    batch: {
      events: [{ type: 'COMMAND_REJECTED', reason: '现在不是你的出牌轮' }],
      view: PLAY_VIEW,
    },
  },
}

/** 摆好前提，然后只跑被考察的那一批，返回它产出的 cue。 */
function cuesFor(sample: Sample) {
  const director = makeDirector(0)
  // 先空跑一次并推过开局发牌的兜底，把「一上来牌就憋着」这件事清干净——
  // 不然每个用例都会先收到一条发牌的 cue，测不出被考察的那条事件到底演没演。
  director.push({ events: [], view: PLAY_VIEW })
  director.advance(60_000)
  for (const batch of sample.before) {
    director.push(batch)
    director.advance(60_000)
  }
  director.drain()
  director.push(sample.batch)
  director.advance(60_000)
  return director.drain()
}

describe('事件覆盖表', () => {
  const types = Object.keys(EVENT_PLAN) as GameEvent['type'][]

  it('每一条都写了理由', () => {
    for (const type of types) {
      const plan = EVENT_PLAN[type]
      const text = plan.handling === 'cue' ? plan.note : plan.reason
      expect(text.length, `${type} 的说明是空的`).toBeGreaterThan(0)
    }
  })

  for (const type of types) {
    const plan = EVENT_PLAN[type]
    const label = plan.handling === 'cue' ? '有演出' : '明确不演'
    it(`${type}：${label}`, () => {
      const cues = cuesFor(SAMPLES[type])
      if (plan.handling === 'cue') {
        expect(cues.length, `${type} 说有演出，却一条 cue 都没产出`).toBeGreaterThan(0)
      } else {
        expect(cues, `${type} 说不演，却产出了 cue`).toEqual([])
      }
    })
  }
})
