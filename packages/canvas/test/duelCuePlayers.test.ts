/**
 * cue → 播放器的覆盖：每一种 cue 都得有人接，而且真的动了某个组件。
 *
 * 两道检查，缺一不可：
 * 1. **类型级**：下面那张样例表是 `Record<Cue['kind'], Cue>`，编排层加一种 cue 而这里没跟上
 *    就编译不过（`CUE_PLAYERS` 那边同理，见 cuePlayers/index.ts）。
 * 2. **运行期**：逐条播一遍，断言至少动了一个假组件。类型对得上但掉进空分支的那种漏，
 *    只有真跑一遍才看得出来——而这正是「一条 cue 播了个寂寞」最容易发生的地方。
 *
 * 这里**不**断言演出的样子（谁飞到哪儿、演多久）：那是截图回归和 bench 剧本的活。
 */

import { describe, expect, it } from 'vitest'
import type { Cue } from '../src/director/cues'
import { CUE_PLAYERS, playCue } from '../src/scenes/duel/cuePlayers/index'
import { createFakeDuelContext } from './helpers/fakeDuelContext'

/** 每种 cue 各一条样例。载荷只求形状对，数值没有意义。 */
const SAMPLE_CUES: Record<Cue['kind'], Cue> = {
  banner: { kind: 'banner', at: 0, durationMs: 1400, text: '第 1 轮' },
  'coin-toss': { kind: 'coin-toss', at: 0, durationMs: 3540, firstPlayer: 0, mineFirst: true },
  'skill-cancel': {
    kind: 'skill-cancel',
    at: 0,
    durationMs: 2260,
    heroId: 'grace-hopper',
    title: 'Debug!',
    text: '抵消了一张牌',
  },
  'reveal-enter': {
    kind: 'reveal-enter',
    at: 0,
    durationMs: 550,
    cardId: 'fake-ai',
    handInstanceId: 'h9',
    cardKind: 'ai',
    fromOrigin: true,
  },
  'reveal-hold': { kind: 'reveal-hold', at: 0, durationMs: 1500 },
  'reveal-land': { kind: 'reveal-land', at: 0, durationMs: 600, instanceId: 'u1' },
  'reveal-fade': { kind: 'reveal-fade', at: 0, durationMs: 320 },
  'reveal-abort': { kind: 'reveal-abort', at: 0, durationMs: 200 },
  'inspect-enter': { kind: 'inspect-enter', at: 0, durationMs: 550, source: 'tile', flipId: 'u1' },
  'inspect-exit': { kind: 'inspect-exit', at: 0, durationMs: 600, source: 'tile', flipId: 'u1' },
  'play-flip': { kind: 'play-flip', at: 0, durationMs: 650, instanceId: 'u1' },
  'skill-showcase': {
    kind: 'skill-showcase',
    at: 0,
    durationMs: 1800,
    cardId: 'fake-skill',
    targetInstanceId: null,
  },
  'skill-fly': {
    kind: 'skill-fly',
    at: 0,
    durationMs: 420,
    from: 'showcase',
    cardId: 'fake-skill',
    targetInstanceId: 'u1',
  },
  'hit-fx': { kind: 'hit-fx', at: 0, durationMs: 200, instanceId: 'u1' },
  'summon-fx': { kind: 'summon-fx', at: 0, durationMs: 800, instanceId: 'u1' },
  'pop-in': { kind: 'pop-in', at: 0, durationMs: 400, instanceId: 'u1' },
  'removal-fx': {
    kind: 'removal-fx',
    at: 0,
    durationMs: 450,
    instanceId: 'u1',
    cardId: 'fake-ai',
    by: 'fake-skill',
  },
  'evolve-fx': {
    kind: 'evolve-fx',
    at: 0,
    durationMs: 900,
    instanceId: 'u1',
    fromCardId: 'fake-ai',
    toCardId: 'fake-ai',
  },
  deal: { kind: 'deal', at: 0, durationMs: 400, side: 'self', count: 1 },
  'settle-open': {
    kind: 'settle-open',
    at: 0,
    durationMs: 550,
    round: 1,
    question: { id: 'q', category: 'meme', text: '题面', keywords: [] },
    scoresBefore: { mine: 0, theirs: 0 },
  },
  'settle-row': {
    kind: 'settle-row',
    at: 0,
    durationMs: 300,
    instanceId: 'u1',
    cardId: 'fake-ai',
    mine: true,
    correct: true,
  },
  'settle-answer': {
    kind: 'settle-answer',
    at: 0,
    durationMs: 600,
    answer: '答',
    explanation: '解',
  },
  'settle-typing': {
    kind: 'settle-typing',
    at: 0,
    durationMs: 900,
    instanceId: 'u1',
    answer: '答',
    reasoning: '因为',
  },
  'settle-stamp': {
    kind: 'settle-stamp',
    at: 0,
    durationMs: 280,
    instanceId: 'u1',
    correct: true,
    safePassed: false,
  },
  'settle-counts': {
    kind: 'settle-counts',
    at: 0,
    durationMs: 400,
    correctCounts: { mine: 2, theirs: 1 },
  },
  'settle-score': {
    kind: 'settle-score',
    at: 0,
    durationMs: 1050,
    gains: { mine: 1, theirs: 0 },
    totals: { mine: 1, theirs: 0 },
    spent: { mine: 3, theirs: 2 },
    verdict: 'more-correct',
  },
  'settle-confirm': { kind: 'settle-confirm', at: 0, durationMs: 350 },
  'settle-exit': { kind: 'settle-exit', at: 0, durationMs: 450 },
  'lock-acquire': { kind: 'lock-acquire', at: 0, durationMs: 0, token: 1, reason: 'play' },
  'lock-release': { kind: 'lock-release', at: 0, durationMs: 0, token: 1 },
  urge: { kind: 'urge', at: 0, durationMs: 3200, lineId: '快点啊' },
  error: { kind: 'error', at: 0, durationMs: 0, reason: 'Token 不够' },
  tutorial: { kind: 'tutorial', at: 0, durationMs: 0, cue: 'deal-done' },
  'clear-overlays': { kind: 'clear-overlays', at: 0, durationMs: 0 },
}

const KINDS = Object.keys(SAMPLE_CUES) as Cue['kind'][]

describe('cue 映射表', () => {
  it('表里的条目和样例一一对应', () => {
    expect(Object.keys(CUE_PLAYERS).sort()).toEqual([...KINDS].sort())
  })

  it.each(KINDS)('%s：播一遍会动到组件', (kind) => {
    const { ctx, calls } = createFakeDuelContext()
    playCue(ctx, SAMPLE_CUES[kind])
    expect(calls.names.length, `「${kind}」这条 cue 播了个寂寞`).toBeGreaterThan(0)
  })
})
