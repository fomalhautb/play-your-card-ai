/**
 * 三条订阅规矩，以及「无变化返回同一引用」那条契约。
 *
 * 这些规矩不是风格问题：事件流少一条补发，开局的发牌动画就没了；
 * 快照多换一次引用，`useSyncExternalStore` 就会一直重渲染。
 */

import type { Director } from '@ai-duel/canvas'
import { describe, expect, it } from 'vitest'
import type { MatchEventBatch, MatchView } from '../src/match/driver'
import { createDriverCore } from '../src/match/driverCore'
import { SAMPLE_EVENTS, SAMPLE_ONE_EVENT, SAMPLE_VIEW } from './helpers/sampleGame'

/**
 * `canvas` 的 `Director.push()` 入参，直接从它的签名上取。
 *
 * 取签名而不是抄一份镜像：编排层改了入参形状，这里当场编译不过，
 * 而抄的那份只会一直对着一个已经不存在的形状点头。
 */
type DirectorPushInput = Parameters<Director['push']>[0]

const EMPTY: MatchView = {
  view: null,
  seat: null,
  status: 'connecting',
  lastRejection: null,
  abortReason: null,
  link: 'down',
  peer: null,
}

const BATCH: MatchEventBatch = { events: SAMPLE_EVENTS, view: SAMPLE_VIEW }

describe('局面订阅', () => {
  it('无变化时返回同一引用，也不通知订阅者', () => {
    const core = createDriverCore(EMPTY)
    let calls = 0
    core.subscribe(() => {
      calls += 1
    })
    const before = core.getSnapshot()

    core.patch({ status: 'connecting', link: 'down' })
    expect(core.getSnapshot()).toBe(before)
    expect(calls).toBe(0)

    core.patch({ status: 'playing' })
    expect(core.getSnapshot()).not.toBe(before)
    expect(core.getSnapshot().status).toBe('playing')
    expect(calls).toBe(1)
  })

  it('退订之后不再收到通知', () => {
    const core = createDriverCore(EMPTY)
    let calls = 0
    const off = core.subscribe(() => {
      calls += 1
    })
    core.patch({ status: 'playing' })
    off()
    core.patch({ status: 'finished' })
    expect(calls).toBe(1)
  })
})

describe('事件订阅', () => {
  it('没人订阅时攒着，第一个订阅者来了按顺序补发', () => {
    const core = createDriverCore(EMPTY)
    core.emitBatch(BATCH)
    core.emitBatch({ events: SAMPLE_ONE_EVENT, view: SAMPLE_VIEW })

    const got: MatchEventBatch[] = []
    core.subscribeEvents((batch) => got.push(batch))
    expect(got).toEqual([BATCH, { events: SAMPLE_ONE_EVENT, view: SAMPLE_VIEW }])

    // 补发过一次就清空了，第二个订阅者不该再收到同一批。
    const second: MatchEventBatch[] = []
    core.subscribeEvents((batch) => second.push(batch))
    expect(second).toEqual([])
  })

  it('只留一个订阅者：后来的顶掉先来的', () => {
    const core = createDriverCore(EMPTY)
    const first: MatchEventBatch[] = []
    const second: MatchEventBatch[] = []
    core.subscribeEvents((batch) => first.push(batch))
    core.subscribeEvents((batch) => second.push(batch))

    core.emitBatch(BATCH)
    expect(first).toEqual([])
    expect(second).toEqual([BATCH])
  })

  it('退订之后的批重新攒起来', () => {
    const core = createDriverCore(EMPTY)
    const got: MatchEventBatch[] = []
    const off = core.subscribeEvents((batch) => got.push(batch))
    off()

    core.emitBatch(BATCH)
    expect(got).toEqual([])
    core.subscribeEvents((batch) => got.push(batch))
    expect(got).toEqual([BATCH])
  })

  it('没有事件的批直接丢掉', () => {
    const core = createDriverCore(EMPTY)
    const got: MatchEventBatch[] = []
    core.subscribeEvents((batch) => got.push(batch))
    core.emitBatch({ events: [], view: SAMPLE_VIEW })
    expect(got).toEqual([])
  })
})

describe('喊话订阅', () => {
  it('允许多个订阅者，每个都收到', () => {
    const core = createDriverCore(EMPTY)
    const first: string[] = []
    const second: string[] = []
    core.subscribeUrge((id) => first.push(id))
    core.subscribeUrge((id) => second.push(id))

    core.emitUrge('hurryUp')
    expect(first).toEqual(['hurryUp'])
    expect(second).toEqual(['hurryUp'])
  })

  it('没人听就直接丢，不补发', () => {
    const core = createDriverCore(EMPTY)
    core.emitUrge('hurryUp')

    const got: string[] = []
    core.subscribeUrge((id) => got.push(id))
    expect(got).toEqual([])
  })
})

describe('事件批的形状', () => {
  it('和演出编排层的入参一致', () => {
    // 这一行是编译期断言：形状对不上 tsc 直接报错，运行时它只是走个过场。
    const forDirector: DirectorPushInput = BATCH satisfies DirectorPushInput
    expect(forDirector.view).toBe(SAMPLE_VIEW)
  })
})
