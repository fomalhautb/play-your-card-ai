/**
 * 两个方向的消息各来一遍：合法样本能解析、JSON 往返之后一模一样，畸形样本被拒且不抛。
 *
 * 房间那几条用的是真实载荷——`test/helpers/sampleGame.ts` 现开一局，
 * 拿 `viewFor` 的裁剪视图和过完 `filterEvent` 的事件流当消息内容。
 * 卡池只在 `match:started` / `match:snapshot` 里发，事件批发的是摘掉卡池的 `ViewDelta`，
 * 这条分工在最后一个 describe 里单独测（见 src/view.ts）。
 */

import { filterEvent } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import type { ClientMessage, ServerMessage } from '../src/index'
import {
  attachCatalog,
  clientMessageSchema,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  serverMessageSchema,
  stripCatalog,
} from '../src/index'
import { SAMPLE_DELTA, SAMPLE_EVENTS, SAMPLE_INSTANCE_ID, SAMPLE_VIEW } from './helpers/sampleGame'

const CLIENT_SAMPLES: ClientMessage[] = [
  { type: 'session:hello', protocolVersion: PROTOCOL_VERSION, clientVersion: '0.1.0+abc1234' },
  { type: 'lobby:queue' },
  { type: 'lobby:cancel' },
  { type: 'lobby:create' },
  { type: 'lobby:join', code: '0417' },
  { type: 'room:loadout', deck: ['gpt-4', 'gpt-4', 'nuclear-plant'], hero: 'grace-hopper' },
  { type: 'room:loadout', deck: ['gpt-4'], hero: null },
  { type: 'room:ready' },
  { type: 'room:leave' },
  { type: 'room:resync', haveSeq: 0 },
  { type: 'room:urge', id: 'hurryUp' },
  // 实例 id 用真实那一局摸到的手牌，「合法样本」四个字才不打折。
  {
    type: 'match:command',
    command: { type: 'PLAY_CARD', player: 0, instanceId: SAMPLE_INSTANCE_ID },
  },
]

const SERVER_SAMPLES: ServerMessage[] = [
  {
    type: 'session:welcome',
    protocolVersion: PROTOCOL_VERSION,
    userId: 'u_9f3c',
    place: { kind: 'lobby' },
  },
  {
    type: 'session:welcome',
    protocolVersion: PROTOCOL_VERSION,
    userId: 'u_9f3c',
    place: { kind: 'room', code: '0417', seat: 1 },
  },
  { type: 'session:rejected', reason: 'protocol-version', notice: '客户端版本太旧，请刷新页面' },
  { type: 'lobby:queued' },
  { type: 'lobby:canceled' },
  { type: 'lobby:room', code: '0417', origin: 'queue' },
  { type: 'lobby:error', reason: 'room-not-found', notice: '房间不存在' },
  { type: 'room:peer', seat: 1, online: true, loaded: true, ready: false },
  { type: 'room:urged', from: 1, id: 'hurryUp' },
  { type: 'room:closed', reason: 'match-over', notice: '对局结束' },
  { type: 'room:error', reason: 'not-your-seat', notice: '这不是你的座位' },
  { type: 'match:started', seat: 0, seq: 1, events: SAMPLE_EVENTS, view: SAMPLE_VIEW },
  { type: 'match:events', seq: 2, events: SAMPLE_EVENTS, view: SAMPLE_DELTA },
  { type: 'match:snapshot', seq: 7, view: SAMPLE_VIEW },
  { type: 'match:rejected', reason: '还没轮到你出牌' },
]

const typesOf = (samples: { type: string }[]) => [...new Set(samples.map((s) => s.type))].sort()

describe('清单对得上', () => {
  it('客户端消息：每一种都有样本', () => {
    const branches = clientMessageSchema.options.map((o) => o.shape.type.value).sort()
    expect(branches).toEqual(typesOf(CLIENT_SAMPLES))
  })

  it('服务端消息：每一种都有样本', () => {
    const branches = serverMessageSchema.options.map((o) => o.shape.type.value).sort()
    expect(branches).toEqual(typesOf(SERVER_SAMPLES))
  })

  it('协议版本常量在，是个正整数', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true)
    expect(PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})

describe('合法样本走一遍 JSON 往返', () => {
  for (const message of CLIENT_SAMPLES) {
    it(`客户端 ${message.type}`, () => {
      const result = parseClientMessage(JSON.stringify(message))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toEqual(message)
    })
  }

  for (const message of SERVER_SAMPLES) {
    it(`服务端 ${message.type}`, () => {
      const result = parseServerMessage(JSON.stringify(message))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toEqual(message)
    })
  }
})

describe('指令回执为什么要单独一条消息', () => {
  it('COMMAND_REJECTED 过不了 filterEvent，所以它不可能混在 match:events 里', () => {
    // core 的 view.ts 对这一条一律返回 null：它是对某条指令的回执，不是局面上发生的事。
    // 服务端因此必须先把它挑出来、用 match:rejected 单独回给发指令的那一方。
    expect(filterEvent({ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }, 0)).toBe(null)
    expect(filterEvent({ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' }, 1)).toBe(null)
  })

  it('开局那批事件里一条回执都没有，可以原样进 match:started', () => {
    expect(SAMPLE_EVENTS.some((event) => event.type === 'COMMAND_REJECTED')).toBe(false)
  })
})

describe('已经解析好的对象也收', () => {
  it('传对象和传 JSON 字符串结果一样', () => {
    const message = CLIENT_SAMPLES[1]!
    expect(parseClientMessage(message)).toEqual(parseClientMessage(JSON.stringify(message)))
  })
})

describe('畸形的客户端消息一律被拒，而且不抛', () => {
  const BAD: [string, unknown][] = [
    ['不是合法 JSON 的字符串', '{ "type": '],
    ['心跳那两个裸字符串走不到这儿', 'ping'],
    ['空对象', {}],
    ['没听说过的 type', { type: 'lobby:hack' }],
    ['type 不是字符串', { type: 42 }],
    ['整个是 null', null],
    ['整个是数字', 7],
    ['二进制帧', new ArrayBuffer(8)],
    ['lobby:join 缺房间码', { type: 'lobby:join' }],
    ['房间码不是四位数字', { type: 'lobby:join', code: '12' }],
    ['房间码混了字母', { type: 'lobby:join', code: '12ab' }],
    ['hello 缺版本号', { type: 'session:hello', clientVersion: '0.1.0' }],
    [
      'clientVersion 超长',
      { type: 'session:hello', protocolVersion: 1, clientVersion: 'v'.repeat(33) },
    ],
    ['多一个字段（客户端消息是严格的）', { type: 'lobby:queue', sneaky: true }],
    ['牌组是空的', { type: 'room:loadout', deck: [], hero: null }],
    ['牌组太长', { type: 'room:loadout', deck: new Array(61).fill('gpt-4'), hero: null }],
    ['英雄不在名单里', { type: 'room:loadout', deck: ['gpt-4'], hero: 'skynet' }],
    ['英雄字段漏了', { type: 'room:loadout', deck: ['gpt-4'] }],
    ['催一催的 id 超长', { type: 'room:urge', id: 'u'.repeat(33) }],
    ['催一催带了文字', { type: 'room:urge', id: 'hurryUp', text: '快点啊' }],
    ['haveSeq 是负数', { type: 'room:resync', haveSeq: -1 }],
    ['haveSeq 是小数', { type: 'room:resync', haveSeq: 1.5 }],
    ['指令里的座位是负数', { type: 'match:command', command: { type: 'END_PLAY', player: -1 } }],
    ['match:command 少了 command', { type: 'match:command' }],
  ]

  for (const [name, input] of BAD) {
    it(name, () => {
      const result = parseClientMessage(input)
      expect(result.ok).toBe(false)
      // 失败要带一句能读的话：服务端把它写进日志，排查线上问题时全靠它。
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
    })
  }
})

describe('严松不对称', () => {
  it('客户端消息多一个字段就整条拒', () => {
    expect(parseClientMessage({ type: 'room:ready', cheat: 1 }).ok).toBe(false)
  })

  it('服务端消息多一个字段只是被丢掉——服务端可以先上线带新字段的版本', () => {
    const result = parseServerMessage({ type: 'lobby:queued', waiting: 3 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ type: 'lobby:queued' })
  })

  it('服务端消息该缺的字段还是不能缺', () => {
    expect(parseServerMessage({ type: 'lobby:room', origin: 'queue' }).ok).toBe(false)
    expect(parseServerMessage({ type: 'match:snapshot', seq: 1 }).ok).toBe(false)
    // 序号从 1 开始：0 是「一条都没收到过」，只在 room:resync 的 haveSeq 里合法。
    expect(parseServerMessage({ type: 'match:snapshot', seq: 0, view: SAMPLE_VIEW }).ok).toBe(false)
  })
})

describe('卡池一局只发一次', () => {
  it('match:started 和 match:snapshot 带整份卡池', () => {
    // 这两条是「整份局面」：开局给一次、重连补一次，客户端后面全靠这份目录查卡面。
    expect(Object.keys(SAMPLE_VIEW.catalog.cards).length).toBeGreaterThan(0)
    expect(Object.keys(SAMPLE_VIEW.catalog.heroes).length).toBeGreaterThan(0)

    for (const type of ['match:started', 'match:snapshot'] as const) {
      const message = SERVER_SAMPLES.find((m) => m.type === type)!
      const result = parseServerMessage(JSON.stringify(message))
      expect(result.ok).toBe(true)
      if (result.ok && 'view' in result.value) {
        expect((result.value.view as { catalog?: unknown }).catalog).toEqual(SAMPLE_VIEW.catalog)
      }
    }
  })

  it('stripCatalog 摘掉的只有卡池，别的字段一个不少', () => {
    expect('catalog' in SAMPLE_DELTA).toBe(false)
    expect(Object.keys(SAMPLE_DELTA).sort()).toEqual(
      Object.keys(SAMPLE_VIEW)
        .filter((key) => key !== 'catalog')
        .sort(),
    )
  })

  it('摘掉卡池能省掉一大半，这才是拆它的理由', () => {
    // 客户端每收一批事件都要吃一份视图，卡池在里面占大头。
    // 具体倍数会随卡表增减而变，所以只卡「小一半以上」这条不会天天翻红的线。
    const full = JSON.stringify(SAMPLE_VIEW).length
    expect(JSON.stringify(SAMPLE_DELTA).length).toBeLessThan(full / 2)
  })

  it('strip 完再 attach 回去等于原来那份视图', () => {
    // 客户端就是这么用的：开局存下 catalog，之后每批事件补回去。
    expect(attachCatalog(SAMPLE_DELTA, SAMPLE_VIEW.catalog)).toEqual(SAMPLE_VIEW)
    // JSON 往返之后也一样——delta 真的过得了网线。
    const delta = JSON.parse(JSON.stringify(SAMPLE_DELTA))
    expect(attachCatalog(delta, SAMPLE_VIEW.catalog)).toEqual(SAMPLE_VIEW)
  })

  it('match:events 里真带了卡池也不拒，只把它丢掉', () => {
    // 下行宽松那一档（见 src/index.ts）：整条作废会让客户端看到序号断档、白跑一趟 resync，
    // 而多带的目录除了浪费带宽并不会算错什么。服务端别多带这件事由 stripCatalog 保证。
    const result = parseServerMessage({
      type: 'match:events',
      seq: 2,
      events: SAMPLE_EVENTS,
      view: SAMPLE_VIEW,
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.value.type === 'match:events') {
      expect('catalog' in result.value.view).toBe(false)
      expect(result.value.view).toEqual(SAMPLE_DELTA)
    }
  })

  it('view 还是要长得像视图，缺 viewer 一样被拒', () => {
    const { viewer: _viewer, ...noViewer } = SAMPLE_DELTA
    expect(
      parseServerMessage({ type: 'match:events', seq: 2, events: [], view: noViewer }).ok,
    ).toBe(false)
  })
})

describe('拆装两个函数都不改原对象', () => {
  it('stripCatalog 不动传进来的视图', () => {
    // viewFor 的产物同一份要发日志、存档好几个地方，就地 delete 会让后面拿到它的人少一份目录。
    const view = { ...SAMPLE_VIEW }
    stripCatalog(view)
    expect(view.catalog).toBe(SAMPLE_VIEW.catalog)
  })
})
