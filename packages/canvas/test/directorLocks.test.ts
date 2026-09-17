/**
 * 带编号的演出锁、抵消层排队、结算层时间线，以及中断时的一次性清场。
 *
 * 这几条同样是照着旧版踩过的坑写的：兜底解锁、连打两张技能牌时的计数、
 * 读题等待是「还差多少」、中断之后不许再有任何演出冒出来。
 */

import { describe, expect, it } from 'vitest'
import {
  aiAnswered,
  aiDeployed,
  answeredQuestion,
  commandRejected,
  cuesOf,
  makeDirector,
  makeView,
  prime,
  questionRevealed,
  roundScored,
  skillCanceled,
  skillPlayed,
} from './helpers/directorFixtures'

/** 我方技能牌无目标那档：淡入 280 + 停留 1200 + 淡出 320。 */
const SKILL_SHOWCASE_TOTAL = 1800

describe('演出锁', () => {
  it('出牌时上锁，事件回来接着用同一把，落地特效演完才放', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.push({ events: [aiDeployed(0, 'p0-a')], view: makeView() })
    director.advance(60_000)
    const cues = director.drain()
    const acquires = cuesOf(cues, 'lock-acquire')
    const releases = cuesOf(cues, 'lock-release')
    // 只上了一把锁：事件回来时接过玩家点下去那一把，而不是再上一把。
    expect(acquires).toHaveLength(1)
    expect(releases).toHaveLength(1)
    expect(releases[0]?.token).toBe(acquires[0]?.token)
    // Flip 650 + 落地特效 800。
    expect(releases[0]?.at).toBe(650 + 800)
  })

  it('等不到事件时兜底把锁放开', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.advance(2499)
    expect(director.locks().handFrozen).toBe(true)
    director.advance(2)
    // PLAY_LOCK_FALLBACK = 2500ms。放开之后退回「出不了牌但还能把牌抬起来看」。
    expect(director.locks().handFrozen).toBe(false)
    expect(cuesOf(director.drain(), 'lock-release')).toHaveLength(1)
  })

  it('兜底放过锁之后，迟到的收尾不许再放别人的锁', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.advance(3000)
    director.drain()
    // 兜底已经把第一把放了；玩家又打出第二张，这次的演出正常起来。
    director.userAction({ kind: 'play-card', instanceId: 'p0-b' })
    director.push({ events: [aiDeployed(0, 'p0-b')], view: makeView() })
    director.advance(100)
    expect(director.locks().handFrozen).toBe(true)
    director.advance(60_000)
    const releases = cuesOf(director.drain(), 'lock-release')
    // 第二把锁只被它自己的收尾放一次，编号对得上。
    expect(releases).toHaveLength(1)
    expect(releases[0]?.token).toBe(2)
  })
})

describe('抵消层排队', () => {
  it('抵消提示要等那张技能牌亮相演完才上', () => {
    const director = makeDirector(0)
    prime(director)
    const cues = (() => {
      director.push({
        events: [skillPlayed(0, 'p0-s', 'fixed-answer'), skillCanceled(0, 'p0-s')],
        view: makeView(),
      })
      director.advance(60_000)
      return director.drain()
    })()
    const cancel = cuesOf(cues, 'skill-cancel')[0]
    // 抵消层先上就会盖住牌面，玩家根本没看清被抵消的是什么牌。
    expect(cancel?.at).toBe(SKILL_SHOWCASE_TOTAL)
  })

  it('连打两张技能牌时按「还有几段在演」记账，不是布尔', () => {
    const director = makeDirector(0)
    prime(director)
    director.push({ events: [skillPlayed(0, 'p0-s1', 'fixed-answer')], view: makeView() })
    director.advance(500)
    director.drain()
    director.push({
      events: [skillPlayed(0, 'p0-s2', 'safe-pass'), skillCanceled(0, 'p0-s2', 'safe-pass')],
      view: makeView(),
    })
    director.advance(60_000)
    const cancel = cuesOf(director.drain(), 'skill-cancel')[0]
    // 布尔的话第一张的收尾（1800ms）就会把抵消放出去，那时第二张还在中央亮着。
    expect(cancel?.at).toBe(500 + SKILL_SHOWCASE_TOTAL)
  })

  it('进答题就把还憋着的抵消提示丢掉', () => {
    const director = makeDirector(0)
    prime(director)
    director.push({
      events: [aiDeployed(1, 'p1-a'), skillCanceled(1, 'p1-a')],
      view: makeView(),
    })
    director.advance(100)
    director.drain()
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    // 等结算层演完再补一句「刚才那张被抵消了」，比不演更让人糊涂。
    expect(cuesOf(director.drain(), 'skill-cancel')).toHaveLength(0)
  })
})

describe('结算层时间线', () => {
  const scoredView = makeView({
    phase: 'settle',
    round: 1,
    questions: [answeredQuestion()],
  })

  it('读题等的是「还差多少」，不是「再等四秒」', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    // 服务端自动交卷比读题时间早到（2.5 秒 < 4 秒）。
    director.advance(2500)
    director.drain()
    director.push({ events: [aiAnswered(0, 'p0-a', true), roundScored()], view: scoredView })
    director.advance(60_000)
    const answer = cuesOf(director.drain(), 'settle-answer')[0]
    // 只补上剩下的 1.5 秒，整层立起来正好满四秒。
    expect(answer?.at).toBe(4000)
  })

  it('主线按顺序走完六拍，标准答案从视图里取', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    director.drain()
    director.push({
      events: [aiAnswered(0, 'p0-a', true), aiAnswered(1, 'p1-a', false), roundScored()],
      view: scoredView,
    })
    director.advance(60_000)
    const cues = director.drain()
    expect(cues.map((cue) => cue.kind)).toEqual([
      'settle-row',
      'settle-answer',
      'settle-row',
      'settle-typing',
      'settle-typing',
      'settle-stamp',
      'settle-stamp',
      'settle-counts',
      'settle-score',
      'settle-confirm',
    ])
    expect(cuesOf(cues, 'settle-answer')[0]?.answer).toBe('标准答案')
  })

  it('保送的那张卡在盖章那一拍多一枚章', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    director.drain()
    director.push({
      events: [
        aiAnswered(0, 'p0-a', false),
        { type: 'AI_SAFE_PASSED', instanceId: 'p0-a', owner: 0 },
        roundScored(),
      ],
      view: scoredView,
    })
    director.advance(60_000)
    const stamp = cuesOf(director.drain(), 'settle-stamp')[0]
    expect(stamp?.safePassed).toBe(true)
    // 判定章 280 之后紧接着补一枚「保送留场」，同样 280。
    expect(stamp?.durationMs).toBe(560)
  })

  it('确认按钮落地之后才点得动，点过一次就不能再点', () => {
    const director = makeDirector(0)
    director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
    director.advance(60_000)
    director.drain()
    director.push({ events: [aiAnswered(0, 'p0-a', true), roundScored()], view: scoredView })
    director.advance(0)
    expect(director.userAction({ kind: 'settle-confirm' })).toBe(false)
    director.advance(60_000)
    expect(director.locks().settleReady).toBe(true)
    expect(director.userAction({ kind: 'settle-confirm' })).toBe(true)
    expect(director.userAction({ kind: 'settle-confirm' })).toBe(false)
  })

  it('随机的逐卡间隔跟着种子走，同一份输入两遍结果一样', () => {
    const play = (seed: number) => {
      const director = makeDirector(0, seed)
      director.push({ events: [questionRevealed()], view: makeView({ phase: 'quiz' }) })
      director.advance(60_000)
      director.drain()
      director.push({
        events: [aiAnswered(0, 'a', true), aiAnswered(0, 'b', true), roundScored()],
        view: scoredView,
      })
      director.advance(60_000)
      return cuesOf(director.drain(), 'settle-typing').map((cue) => cue.at)
    }
    expect(play(1)).toEqual(play(1))
    expect(play(1)).not.toEqual(play(7))
  })
})

describe('中断清场', () => {
  it('abort 之后所有过场收掉、锁放开，再推时钟一条 cue 都不出', () => {
    const director = makeDirector(0)
    director.push({
      events: [{ type: 'GAME_STARTED', firstPlayer: 0 }, aiDeployed(1, 'p1-a')],
      view: makeView(),
    })
    director.advance(100)
    director.drain()
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.drain()

    director.abort()
    const cues = director.drain()
    expect(cues.map((cue) => cue.kind)).toContain('clear-overlays')
    expect(cuesOf(cues, 'lock-release')).toHaveLength(1)
    expect(director.locks().handFrozen).toBe(false)

    director.advance(60_000)
    expect(director.drain()).toEqual([])
  })

  it('中断之后不再受理任何事件和操作', () => {
    const director = makeDirector(0)
    prime(director)
    director.abort()
    director.drain()
    director.push({ events: [aiDeployed(1, 'p1-a')], view: makeView() })
    director.advance(60_000)
    expect(director.drain()).toEqual([])
    expect(director.userAction({ kind: 'inspect-open', source: 'tile', flipId: 'x' })).toBe(false)
  })
})

/**
 * 「打出去的那张牌归谁」。
 *
 * 玩家松手那一刻牌就离开了扇形、开始朝落点飞（见 scenes/duel/input.ts），而这一下成不成
 * 要等回包。不成的那几条路上没有别的 cue 会来接手它，所以编排层必须自己说一句「它回来」——
 * 少了这句，那张牌会一直停在最顶上的拖拽层里，把战场和手牌一起挡死。
 */
describe('打出去却没人接手的那张牌', () => {
  it('指令被拒：红字之外还要把牌收回来', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.push({ events: [commandRejected()], view: makeView() })
    director.advance(60_000)
    const cues = director.drain()
    expect(cuesOf(cues, 'error')).toHaveLength(1)
    expect(cuesOf(cues, 'play-return').map((cue) => cue.instanceId)).toEqual(['p0-a'])
  })

  it('演出真的起来了就不收：那张牌已经在飞了', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.push({ events: [aiDeployed(0, 'p0-a')], view: makeView() })
    director.advance(60_000)
    expect(cuesOf(director.drain(), 'play-return')).toHaveLength(0)
  })

  it('回包一直不来：兜底解锁的同时把牌放回手上', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.advance(3000)
    const cues = director.drain()
    expect(cuesOf(cues, 'play-return').map((cue) => cue.instanceId)).toEqual(['p0-a'])
    // 顺序要紧：先把牌收回去再解冻手牌，否则界面解冻的那一拍战场上还压着一张飞了一半的牌。
    const returnAt = cues.findIndex((cue) => cue.kind === 'play-return')
    const releaseAt = cues.findIndex((cue) => cue.kind === 'lock-release')
    expect(returnAt).toBeLessThan(releaseAt)
  })

  it('演出接手之后，兜底不会再去收一张已经飞走的牌', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.push({ events: [aiDeployed(0, 'p0-a')], view: makeView() })
    director.advance(60_000)
    director.drain()
    // 兜底那条排程早该被撤掉了（clearPlayLockFallback），再推多久也不该冒出收牌那条。
    director.advance(60_000)
    expect(cuesOf(director.drain(), 'play-return')).toHaveLength(0)
  })

  it('对局中断：那张飞到一半的牌一并收回', () => {
    const director = makeDirector(0)
    prime(director)
    director.userAction({ kind: 'play-card', instanceId: 'p0-a' })
    director.drain()
    director.abort()
    expect(cuesOf(director.drain(), 'play-return')).toHaveLength(1)
  })
})
