/**
 * 联机 driver：握手、事件流、序号对账、快照、重连、收场。
 *
 * 消息一律用 protocol 的类型造、过一遍 `parseServerMessage`（见 helpers/harness.ts），
 * 载荷是现开一局真对局算出来的（helpers/sampleGame.ts）。
 * 手写 JSON 的话，服务端哪天改了一个字段名这组测试还是全绿的。
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { MatchEventBatch } from '../src/match/driver'
import type { ServerDriver } from '../src/match/serverDriver'
import { createServerDriver } from '../src/match/serverDriver'
import { createHarness, type Harness } from './helpers/harness'
import {
  SAMPLE_DELTA,
  SAMPLE_EVENTS,
  SAMPLE_ONE_EVENT,
  SAMPLE_SEAT,
  SAMPLE_VIEW,
} from './helpers/sampleGame'

const ORIGIN = 'http://127.0.0.1:8787'
const CODE = '4821'
const TOKEN = 'jwt-测试用的一张纸'

const drivers: ServerDriver[] = []

afterEach(() => {
  // 每个 driver 都挂着一个心跳定时器，不收掉的话会一直跑到进程结束。
  for (const driver of drivers.splice(0)) driver.dispose()
})

function start(): { harness: Harness; driver: ServerDriver } {
  const harness = createHarness()
  const driver = createServerDriver({
    platform: harness.platform,
    tokenProvider: () => Promise.resolve(TOKEN),
    code: CODE,
    origin: ORIGIN,
  })
  drivers.push(driver)
  return { harness, driver }
}

/** 连上并握完手：接受连接 → 服务端回 welcome。之后 driver 手上有座位。 */
function connect(harness: Harness): void {
  harness.socket().acceptConnection()
  harness.deliver({
    type: 'session:welcome',
    protocolVersion: 1,
    userId: 'u-1',
    place: { kind: 'room', code: CODE, seat: SAMPLE_SEAT },
  })
}

describe('握手', () => {
  it('连的是房间地址，连上第一条发 session:hello', () => {
    const { harness } = start()
    expect(harness.socket().urls).toEqual([`ws://127.0.0.1:8787/match/${CODE}`])

    harness.socket().acceptConnection()
    expect(harness.sent()[0]).toEqual({
      type: 'session:hello',
      protocolVersion: 1,
      clientVersion: '0.0.0-dev',
    })
  })

  it('welcome 之后座位就位，并马上要一份快照', () => {
    const { harness, driver } = start()
    connect(harness)

    expect(driver.getSnapshot().seat).toBe(SAMPLE_SEAT)
    expect(harness.sent()[1]).toEqual({ type: 'room:resync', haveSeq: 0 })
  })

  it('对局还没开始时那条 resync 会被回 not-in-match，不当成玩家的错', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({ type: 'room:error', reason: 'not-in-match', notice: '对局还没开始' })

    expect(driver.getSnapshot().lastRejection).toBeNull()
  })

  it('别的 room:error 要显示给玩家', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({ type: 'room:error', reason: 'bad-loadout', notice: '这副牌组不合法' })

    expect(driver.getSnapshot().lastRejection).toBe('这副牌组不合法')
  })

  it('session:rejected 之后是 aborted，而且不再重连', () => {
    const { harness, driver } = start()
    harness.socket().acceptConnection()
    harness.deliver({ type: 'session:rejected', reason: 'room-full', notice: '房间已满' })

    expect(driver.getSnapshot().status).toBe('aborted')
    expect(driver.getSnapshot().abortReason).toBe('房间已满')
    expect(harness.socket().state).toBe('closed')
  })
})

describe('事件流', () => {
  it('match:started 发出第一批，视图和座位一起到位', () => {
    const { harness, driver } = start()
    const batches: MatchEventBatch[] = []
    driver.subscribeEvents((batch) => batches.push(batch))
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })

    expect(batches).toHaveLength(1)
    expect(batches[0]?.events).toHaveLength(SAMPLE_EVENTS.length)
    const snapshot = driver.getSnapshot()
    expect(snapshot.status).toBe('playing')
    expect(snapshot.link).toBe('ok')
    expect(snapshot.view?.catalog).toBeDefined()
  })

  it('开局那批在界面订阅之前就到，订阅上来时补发', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })

    const batches: MatchEventBatch[] = []
    driver.subscribeEvents((batch) => batches.push(batch))
    expect(batches).toHaveLength(1)
  })

  it('match:events 用开局那份卡池把视图补全', () => {
    const { harness, driver } = start()
    const batches: MatchEventBatch[] = []
    driver.subscribeEvents((batch) => batches.push(batch))
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })
    harness.deliver({ type: 'match:events', seq: 2, events: SAMPLE_ONE_EVENT, view: SAMPLE_DELTA })

    expect(batches).toHaveLength(2)
    // 电线上那份没有 catalog，接回去之后界面拿到的一律是完整视图。
    expect(batches[1]?.view.catalog).toEqual(SAMPLE_VIEW.catalog)
    expect(driver.getSnapshot().view?.catalog).toEqual(SAMPLE_VIEW.catalog)
  })

  it('seq 跳号：这批不转发，改成要一份快照', () => {
    const { harness, driver } = start()
    const batches: MatchEventBatch[] = []
    driver.subscribeEvents((batch) => batches.push(batch))
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })
    harness.deliver({ type: 'match:events', seq: 4, events: SAMPLE_ONE_EVENT, view: SAMPLE_DELTA })

    expect(batches).toHaveLength(1)
    const resyncs = harness.sent().filter((message) => message.type === 'room:resync')
    // 第一条是握手时那次，第二条是这次漏包。
    expect(resyncs).toEqual([
      { type: 'room:resync', haveSeq: 0 },
      { type: 'room:resync', haveSeq: 1 },
    ])
  })

  it('快照还没回来时不重复要：一次漏包只发一条 resync', () => {
    const { harness } = start()
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })
    harness.deliver({ type: 'match:events', seq: 4, events: SAMPLE_ONE_EVENT, view: SAMPLE_DELTA })
    harness.deliver({ type: 'match:events', seq: 5, events: SAMPLE_ONE_EVENT, view: SAMPLE_DELTA })

    const resyncs = harness.sent().filter((message) => message.type === 'room:resync')
    expect(resyncs).toHaveLength(2)
  })

  it('快照整份换掉视图并把序号对齐，之后的下一批就接得上了', () => {
    const { harness, driver } = start()
    const batches: MatchEventBatch[] = []
    driver.subscribeEvents((batch) => batches.push(batch))
    connect(harness)
    harness.deliver({ type: 'match:snapshot', seq: 9, view: SAMPLE_VIEW })

    // 快照不补演出：只换局面，一条事件都不该播。
    expect(batches).toEqual([])
    expect(driver.getSnapshot().view).toEqual(SAMPLE_VIEW)
    expect(driver.getSnapshot().link).toBe('ok')

    harness.deliver({ type: 'match:events', seq: 10, events: SAMPLE_ONE_EVENT, view: SAMPLE_DELTA })
    expect(batches).toHaveLength(1)
  })

  it('指令被拒会显示原因，下一批事件到了就翻篇', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })
    harness.deliver({ type: 'match:rejected', reason: '这张牌打不出去' })
    expect(driver.getSnapshot().lastRejection).toBe('这张牌打不出去')

    harness.deliver({ type: 'match:events', seq: 2, events: SAMPLE_ONE_EVENT, view: SAMPLE_DELTA })
    expect(driver.getSnapshot().lastRejection).toBeNull()
  })
})

describe('重连', () => {
  it('断了是 link down，重新握手拿到快照才算通', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({
      type: 'match:started',
      seat: SAMPLE_SEAT,
      seq: 1,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })
    expect(driver.getSnapshot().link).toBe('ok')

    harness.socket().dropConnection({ code: 1006 })
    expect(driver.getSnapshot().link).toBe('down')
    // 局面留在屏幕上，只是消息送不到了。
    expect(driver.getSnapshot().status).toBe('playing')

    connect(harness)
    expect(driver.getSnapshot().link).toBe('down')
    // 重连之后报的是手上最后一个号，服务端拿它记日志。
    const resyncs = harness.sent().filter((message) => message.type === 'room:resync')
    expect(resyncs.at(-1)).toEqual({ type: 'room:resync', haveSeq: 1 })

    harness.deliver({ type: 'match:snapshot', seq: 6, view: SAMPLE_VIEW })
    expect(driver.getSnapshot().link).toBe('ok')
  })
})

describe('收场', () => {
  it('match-over 是打完了', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({ type: 'room:closed', reason: 'match-over', notice: '这一局打完了' })

    expect(driver.getSnapshot().status).toBe('finished')
    expect(driver.getSnapshot().abortReason).toBeNull()
    // 服务端关这条连接用的是 1000，不收掉的话底层会连回一个已经收摊的房间。
    expect(harness.socket().state).toBe('closed')
  })

  it('对手走了是中断，带原因', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({ type: 'room:closed', reason: 'peer-left', notice: '对手离开了房间' })

    expect(driver.getSnapshot().status).toBe('aborted')
    expect(driver.getSnapshot().abortReason).toBe('对手离开了房间')
  })
})

describe('房间成员和喊话', () => {
  it('对手状态没变时不换快照引用', () => {
    const { harness, driver } = start()
    connect(harness)
    harness.deliver({ type: 'room:peer', seat: 1, online: true, loaded: false, ready: false })
    const first = driver.getSnapshot()
    expect(first.peer).toEqual({ online: true, loaded: false, ready: false })

    harness.deliver({ type: 'room:peer', seat: 1, online: true, loaded: false, ready: false })
    expect(driver.getSnapshot()).toBe(first)

    harness.deliver({ type: 'room:peer', seat: 1, online: true, loaded: true, ready: false })
    expect(driver.getSnapshot().peer?.loaded).toBe(true)
  })

  it('本端喊一句会发出去，也在本地播一遍', () => {
    const { harness, driver } = start()
    connect(harness)
    const heard: string[] = []
    driver.subscribeUrge((id) => heard.push(id))

    driver.urge('hurryUp')
    expect(harness.sent().at(-1)).toEqual({ type: 'room:urge', id: 'hurryUp' })
    // 服务端只把喊话转给对面，不回给发起人，所以本地这一遍不能省。
    expect(heard).toEqual(['hurryUp'])

    harness.deliver({ type: 'room:urged', from: 1, id: 'wellPlayed' })
    expect(heard).toEqual(['hurryUp', 'wellPlayed'])
  })

  it('装载、就绪、离开、出牌都发的是协议认的那几条', () => {
    const { harness, driver } = start()
    connect(harness)
    driver.loadout(['gpt-4'], 'danqi-chen')
    driver.ready()
    driver.send({ type: 'PLAY_CARD', player: SAMPLE_SEAT, instanceId: 'p0-c1' })
    driver.leave()

    expect(harness.sent().slice(2)).toEqual([
      { type: 'room:loadout', deck: ['gpt-4'], hero: 'danqi-chen' },
      { type: 'room:ready' },
      {
        type: 'match:command',
        command: { type: 'PLAY_CARD', player: SAMPLE_SEAT, instanceId: 'p0-c1' },
      },
      { type: 'room:leave' },
    ])
  })
})
