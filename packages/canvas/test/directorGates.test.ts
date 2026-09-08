/**
 * 三套排队 / 闸门机制的单元测试：横幅队列、展示层互斥、发牌闸门。
 *
 * 每一条对应旧版 `MatchStage.tsx` 里踩过一次的坑，注释里写了是哪一条。
 * 这几条测的是「事件挤在一起」的时序，golden 快照测的是「正常节奏」，两边分工不同。
 */

import type { GameEvent } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import {
  aiDeployed,
  cardDrawn,
  cuesOf,
  kindsOf,
  makeDirector,
  makeView,
  prime,
  questionRevealed,
  runBatch,
  skillPlayed,
} from './helpers/directorFixtures'

/** 抛硬币这一层从起到收 3540ms，见 timings.ts。 */
const COIN_TOTAL = 3540
/** 一条横幅 300 + 750 + 350。 */
const BANNER_TOTAL = 1400
/** 结算层退场 450ms。 */
const SETTLE_EXIT = 450

const ROUND_STARTED: GameEvent = {
  type: 'ROUND_STARTED',
  round: 1,
  firstPlayer: 0,
  category: 'meme',
  keywords: [],
}

describe('横幅队列', () => {
  it('抛硬币期间的横幅只入队，过场收完才一条条播', () => {
    const director = makeDirector(0)
    const cues = runBatch(director, {
      events: [{ type: 'GAME_STARTED', firstPlayer: 0 }, ROUND_STARTED],
      view: makeView(),
    })
    const banners = cuesOf(cues, 'banner')
    expect(banners).toHaveLength(1)
    // 硬币还在转的 3.54 秒里横幅一条都不许上：那段屏幕整个被过场盖着。
    expect(banners[0]?.at).toBe(COIN_TOTAL)
  })

  it('一批里的两条横幅排队播，不叠在一起', () => {
    const director = makeDirector(0)
    prime(director)
    const cues = runBatch(director, {
      events: [ROUND_STARTED, { type: 'PLAY_TURN_STARTED', player: 0 }],
      view: makeView(),
    })
    const banners = cuesOf(cues, 'banner')
    expect(banners.map((cue) => cue.at - banners[0]!.at)).toEqual([0, BANNER_TOTAL])
  })

  it('队列彻底播空才报 round-banner-done', () => {
    const director = makeDirector(0)
    prime(director)
    const cues = runBatch(director, {
      events: [ROUND_STARTED, { type: 'PLAY_TURN_STARTED', player: 0 }],
      view: makeView(),
    })
    const done = cuesOf(cues, 'tutorial').filter((cue) => cue.cue === 'round-banner-done')
    expect(done).toHaveLength(1)
    const banners = cuesOf(cues, 'banner')
    expect(done[0]?.at).toBe(banners[1]!.at + BANNER_TOTAL)
  })

  it('强制展示期间的横幅也憋着，展示收完才放', () => {
    const director = makeDirector(0)
    prime(director)
    const cues = runBatch(director, {
      events: [aiDeployed(1, 'p1-a'), { type: 'PLAY_TURN_STARTED', player: 0 }],
      view: makeView(),
    })
    const banner = cuesOf(cues, 'banner')[0]
    const revealEnter = cuesOf(cues, 'reveal-enter')[0]
    expect(revealEnter).toBeDefined()
    // 进场 550 + 停留 1500 + 遮罩淡出 300，闸门才放开。
    expect(banner?.at).toBe(revealEnter!.at + 550 + 1500 + 300)
  })
})

describe('展示层互斥', () => {
  it('第二张牌受理不了时降级成简易进场，不排队', () => {
    const director = makeDirector(0)
    prime(director)
    const cues = runBatch(director, {
      events: [aiDeployed(1, 'p1-a'), aiDeployed(1, 'p1-b')],
      view: makeView(),
    })
    // 第一张走强制展示，第二张直接退回简易进场——排队的话玩家要等三秒才看见它上场。
    expect(cuesOf(cues, 'reveal-enter').map((cue) => cue.handInstanceId)).toEqual(['p1-a'])
    expect(cuesOf(cues, 'pop-in').map((cue) => cue.instanceId)).toEqual(['p1-b'])
  })

  it('对方技能牌受理不了就什么都不演（它没有落场可以退回去）', () => {
    const director = makeDirector(0)
    prime(director)
    const cues = runBatch(director, {
      events: [aiDeployed(1, 'p1-a'), skillPlayed(1, 'p1-s')],
      view: makeView(),
    })
    expect(cuesOf(cues, 'reveal-enter')).toHaveLength(1)
    expect(cuesOf(cues, 'pop-in')).toHaveLength(0)
  })

  it('找不到起飞点时 AI 牌降级、技能牌改成从中央淡入', () => {
    // 没喂过第一批视图 = 对手手牌在画面上还不存在（联机客人中途接手就是这样）。
    const aiOnly = makeDirector(0)
    const aiCues = runBatch(aiOnly, { events: [aiDeployed(1, 'p1-a')], view: makeView() })
    expect(kindsOf(aiCues)).toContain('pop-in')

    const skillOnly = makeDirector(0)
    const skillCues = runBatch(skillOnly, { events: [skillPlayed(1, 'p1-s')], view: makeView() })
    const enter = cuesOf(skillCues, 'reveal-enter')[0]
    // 降级路径是从中央淡入 280ms，不是从对手手里飞过来的 550ms。
    expect(enter?.fromOrigin).toBe(false)
    expect(enter?.durationMs).toBe(280)
  })

  it('答题阶段开始时强行收掉还没演完的展示', () => {
    const director = makeDirector(0)
    prime(director)
    director.push({ events: [aiDeployed(1, 'p1-a')], view: makeView() })
    // 停留才走到一半，这时候答题层要立起来了。
    director.advance(800)
    director.drain()
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(0)
    const cues = director.drain()
    expect(kindsOf(cues)).toEqual(['reveal-abort', 'settle-open', 'tutorial'])
    // 收掉之后原来那条链路不许再往下演。
    director.advance(60_000)
    expect(cuesOf(director.drain(), 'reveal-land')).toHaveLength(0)
  })

  it('前一次展示的落场收尾不会被后一次的强行收场掐掉', () => {
    const director = makeDirector(0)
    prime(director)
    director.push({ events: [aiDeployed(1, 'p1-a')], view: makeView() })
    // 2350ms 时第一张的闸门就放开了（遮罩淡完），而它的落场飞行和落地特效还要再演一秒多。
    director.advance(2400)
    director.push({ events: [aiDeployed(1, 'p1-b')], view: makeView() })
    director.advance(50)
    // 这时答题层立起来，把第二次展示强行收掉。
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    const cues = director.drain()
    // 收的只该是第二次那一份：第一张牌的落地特效照演，它那把锁也照常有人放。
    expect(cuesOf(cues, 'summon-fx').map((cue) => cue.instanceId)).toEqual(['p1-a'])
    expect(director.locks().handFrozen).toBe(false)
  })

  it('放大查看在展示层占着时开不了，收掉之后才开得了', () => {
    const director = makeDirector(0)
    prime(director)
    director.push({ events: [aiDeployed(1, 'p1-a')], view: makeView() })
    director.advance(0)
    expect(director.userAction({ kind: 'inspect-open', source: 'tile', flipId: 'p0-a' })).toBe(
      false,
    )
    director.advance(60_000)
    director.drain()
    expect(director.userAction({ kind: 'inspect-open', source: 'tile', flipId: 'p0-a' })).toBe(true)
  })
})

describe('发牌闸门', () => {
  it('开局的牌憋到抛硬币过场收完才飞', () => {
    const director = makeDirector(0)
    const cues = runBatch(director, {
      events: [{ type: 'GAME_STARTED', firstPlayer: 0 }, cardDrawn(0), cardDrawn(0), cardDrawn(1)],
      view: makeView(),
    })
    const deals = cuesOf(cues, 'deal')
    expect(deals.map((cue) => [cue.side, cue.count, cue.at])).toEqual([
      ['self', 2, COIN_TOTAL],
      ['opponent', 1, COIN_TOTAL],
    ])
  })

  it('这一局没有抛硬币时，兜底到点也得把牌放出去', () => {
    const director = makeDirector(0)
    const cues = runBatch(director, { events: [cardDrawn(0)], view: makeView() })
    // DEAL_HOLD_FALLBACK = 800ms。
    expect(cuesOf(cues, 'deal')[0]?.at).toBe(800)
  })

  it('回合末的补牌拦到结算层退场之后才飞', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    director.drain()

    const cues = runBatch(director, {
      events: [{ type: 'ROUND_CONFIRMED', player: 1 }, cardDrawn(0), cardDrawn(1), ROUND_STARTED],
      view: makeView({ phase: 'play', round: 2 }),
    })
    const exit = cuesOf(cues, 'settle-exit')[0]
    const deal = cuesOf(cues, 'deal')[0]
    expect(exit).toBeDefined()
    // 不拦的话牌就在结算层那块遮罩后面飞完了，玩家一眼都没看见。
    expect(deal?.at).toBe(exit!.at + SETTLE_EXIT)
  })

  it('结算层立着时，没有确认的那一批照旧当场发牌（调试面板的「加 1 张」）', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    director.drain()
    // 先手确认的那一批只有确认、没有补牌，局面根本没推进，不该拦。
    const confirmOnly = runBatch(director, {
      events: [{ type: 'ROUND_CONFIRMED', player: 1 }],
      view: makeView({ phase: 'settle' }),
    })
    expect(cuesOf(confirmOnly, 'deal')).toHaveLength(0)
    // 玩家自己点出来的加牌那一批没有确认，该当场就飞。
    const now = 120_000
    const drawOnly = runBatch(director, {
      events: [cardDrawn(0)],
      view: makeView({ phase: 'settle' }),
    })
    expect(cuesOf(drawOnly, 'deal')[0]?.at).toBe(now)
  })

  it('回合末拦下的牌，兜底到点也会放（结算层的退场没走到时）', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    director.drain()
    // 阶段仍停在 settle：结算层不会退场，也就没有退场来放行。
    const cues = runBatch(director, {
      events: [{ type: 'ROUND_CONFIRMED', player: 1 }, cardDrawn(0)],
      view: makeView({ phase: 'settle' }),
    })
    // ROUND_DEAL_FALLBACK = 2000ms，刻意取短，见 timings.ts 里的理由。
    expect(cuesOf(cues, 'deal')[0]?.at).toBe(62_000)
  })

  it('发牌全部落地那一刻报一次 deal-done', () => {
    const director = makeDirector(0)
    const cues = runBatch(director, {
      events: [{ type: 'GAME_STARTED', firstPlayer: 0 }, cardDrawn(0), cardDrawn(0)],
      view: makeView(),
    })
    const done = cuesOf(cues, 'tutorial').filter((cue) => cue.cue === 'deal-done')
    // 两张牌：400 + 一次 120 的错开。
    expect(done.map((cue) => cue.at)).toEqual([COIN_TOTAL + 520])
  })
})
