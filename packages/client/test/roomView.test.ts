/**
 * 房间页那份「状态怎么翻译成画面」的纯函数。
 *
 * 值得单独测是因为这几条判断错了要**两台机器凑齐**才看得见，而且看见的时候往往
 * 已经分不清是界面判错了还是消息没到：
 * 「对方还没来」和「对方掉线了」在协议上是同一位（`room:peer` 的 `online: false`），
 * 链路断了不该被说成对局中断，准备钮点过就不能再点。
 */

import { describe, expect, it } from 'vitest'
import type { MatchView, PeerState } from '../src/match/driver'
import { type RoomFlow, roomViewOf } from '../src/screens/roomView'

/** 一份只填了这几个函数会读的字段的局面。 */
function match(extra: Partial<MatchView> = {}): MatchView {
  return {
    view: null,
    seat: 0,
    status: 'playing',
    lastRejection: null,
    abortReason: null,
    link: 'ok',
    peer: null,
    ...extra,
  }
}

function peer(extra: Partial<PeerState> = {}): PeerState {
  return { online: true, loaded: true, ready: false, ...extra }
}

const IN_ROOM: RoomFlow = { kind: 'room', code: '4821' }

/** 房里那一档：`flow` 和 `match` 得配套给，缺一个整页的状态就对不上。 */
function inRoom(options: { match?: Partial<MatchView>; mineReady?: boolean; peerSeen?: boolean }) {
  return roomViewOf({
    account: '游客 3f2a',
    flow: IN_ROOM,
    match: match(options.match),
    mineReady: options.mineReady ?? false,
    peerSeen: options.peerSeen ?? false,
    notice: null,
  })
}

describe('还没进房', () => {
  it('什么都没开始时不说话，也不摆准备钮', () => {
    const view = roomViewOf({
      account: '游客 3f2a',
      flow: { kind: 'idle' },
      match: null,
      mineReady: false,
      peerSeen: false,
      notice: null,
    })
    expect(view.phase).toBe('idle')
    expect(view.status).toBeNull()
    expect(view.code).toBeNull()
    expect(view.ready).toBe('hidden')
  })

  it('三条路各说各的那一句', () => {
    const say = (origin: 'queue' | 'create' | 'join') =>
      roomViewOf({
        account: null,
        flow: { kind: 'busy', origin },
        match: null,
        mineReady: false,
        peerSeen: false,
        notice: null,
      }).status
    expect(say('queue')).toContain('匹配')
    expect(say('create')).toContain('开房')
    expect(say('join')).toContain('进房')
  })
})

describe('房里', () => {
  it('座位还没到手就先不摆准备钮', () => {
    // 那时 loadout 还没报上去，点了只会换来一句「先装载牌组再就绪」。
    expect(inRoom({ match: { seat: null } }).ready).toBe('hidden')
  })

  it('链路断了压过一切，不去读 peer 那几项旧值', () => {
    const view = inRoom({ match: { link: 'down', peer: peer({ ready: true }) }, peerSeen: true })
    expect(view.status).toContain('断开')
  })

  it('对方没露过面是「等他进来」，露过面才是「掉线了」', () => {
    expect(inRoom({ match: { peer: peer({ online: false }) } }).status).toContain('等他进来')
    expect(inRoom({ match: { peer: peer({ online: false }) }, peerSeen: true }).status).toContain(
      '掉线',
    )
  })

  it('对方就绪之后，等的是我还是等开局，说法不一样', () => {
    expect(inRoom({ match: { peer: peer({ ready: true }) } }).status).toContain('等你了')
    expect(inRoom({ match: { peer: peer({ ready: true }) }, mineReady: true }).status).toContain(
      '就要开始',
    )
  })

  it('点过准备就灰掉，不给玩家发第二条 room:ready 的机会', () => {
    expect(inRoom({}).ready).toBe('idle')
    expect(inRoom({ mineReady: true }).ready).toBe('done')
  })

  it('房间码原样摆出来', () => {
    expect(inRoom({}).code).toBe('4821')
  })
})

describe('提示', () => {
  it('调用方给的那一句优先，没有才退回 driver 记下的最近一次被拒', () => {
    const withBoth = roomViewOf({
      account: null,
      flow: IN_ROOM,
      match: match({ lastRejection: '这副牌组不合法' }),
      mineReady: false,
      peerSeen: false,
      notice: '房间不存在',
    })
    expect(withBoth.notice).toBe('房间不存在')
    expect(inRoom({ match: { lastRejection: '这副牌组不合法' } }).notice).toBe('这副牌组不合法')
  })
})
