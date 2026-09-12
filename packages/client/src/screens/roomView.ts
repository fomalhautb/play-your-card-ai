/**
 * 房间页那份状态怎么翻译成画面（`RoomView`）。纯函数，不碰 React 也不碰网络。
 *
 * 拎出来是因为这一页的判断有三处容易写错，而写错了要两台机器凑在一起才看得见：
 * 1. **「对方还没来」和「对方掉线了」在协议上长得一模一样**——两种都是
 *    `room:peer` 的 `online: false`（私人房里 1 号座还空着时服务端照样发这一条）。
 *    分得开它们的只有「他出现过没有」，所以那一位状态得由调用方自己记着。
 * 2. **链路断了不等于对局中断**：`link` 是 `'down'` 时局面还在，只是消息送不到，
 *    这一页该说「正在重连」而不是把玩家赶回去（见 match/driver.ts 的 `MatchLink`）。
 * 3. **「准备」钮点过就不能再点**：服务端不收第二条 `room:ready`（回 `already-ready`）。
 */

import type { RoomView } from '@ai-duel/canvas'
import type { LobbyRoomOrigin, RoomCode } from '@ai-duel/protocol'
import type { MatchView } from '../match/driver'

/** 这一页走到哪一步了。只有这三种，`driver` 由调用方另外持有（它不是一份能比较的值）。 */
export type RoomFlow =
  /** 什么都没开始。 */
  | { kind: 'idle' }
  /** 正在等大厅答复。`origin` 决定说哪一句「正在…」。 */
  | { kind: 'busy'; origin: LobbyRoomOrigin }
  /** 已经在房里。 */
  | { kind: 'room'; code: RoomCode }

export interface RoomViewInput {
  /** 账号名，「游客 3f2a」。还没开出号来是 null。 */
  account: string | null
  flow: RoomFlow
  /** 房间 driver 的快照。`flow` 不是 `'room'` 时是 null。 */
  match: MatchView | null
  /** 本端点过「准备」没有。 */
  mineReady: boolean
  /** 对方在这一次房间里**出现过**没有。理由见文件头第 1 条。 */
  peerSeen: boolean
  /** 一句要弹出来的提示（大厅报的错、房间收摊的原因）。 */
  notice: string | null
}

/** 三条路各自那句「正在…」。 */
const BUSY_STATUS: Record<LobbyRoomOrigin, string> = {
  queue: '正在匹配对手…',
  create: '正在开房…',
  join: '正在进房…',
}

/** 在房里时中间那一行说什么。 */
function roomStatusOf(match: MatchView, mineReady: boolean, peerSeen: boolean): string {
  // 链路断了压在最前面：这时候 peer 那几项都是断线前的旧值，照它们说话会误导玩家。
  if (match.link === 'down') return '和服务器断开了，正在重连…'
  if (match.seat === null) return '正在进入房间…'
  const peer = match.peer
  if (peer === null || !peer.online) {
    // 不给具体的期限，理由见 matchStatus.ts：权威房间没有「宽限期」这回事。
    return peerSeen ? '对方掉线了，正在等他回来' : '把房间码告诉朋友，等他进来'
  }
  if (peer.ready) return mineReady ? '双方就绪，就要开始了' : '对方已准备，等你了'
  return '对方进来了，两边都点准备就开始'
}

/** 一份要交给画布的状态。 */
export function roomViewOf(input: RoomViewInput): RoomView {
  const { flow, match } = input
  const inRoom = flow.kind === 'room' && match !== null
  return {
    account: input.account,
    phase: flow.kind,
    status: statusOf(input),
    code: flow.kind === 'room' ? flow.code : null,
    // 座位还没到手时先别摆「准备」：那时 loadout 还没报上去，点了只会换来一句
    // 「先装载牌组再就绪」（server 的 handleReady）。
    ready: inRoom && match.seat !== null ? (input.mineReady ? 'done' : 'idle') : 'hidden',
    /*
     * 提示优先显示调用方给的那一句（大厅报错、房间收摊），没有才退回 driver 记下的
     * 最近一次指令被拒。两者不会同时有意义：前者说的是「这一次操作没成」，
     * 后者说的是「刚发的那条消息服务端没收」。
     */
    notice: input.notice ?? match?.lastRejection ?? null,
  }
}

function statusOf(input: RoomViewInput): string | null {
  switch (input.flow.kind) {
    case 'idle':
      return null
    case 'busy':
      return BUSY_STATUS[input.flow.origin]
    case 'room':
      return input.match === null
        ? '正在进入房间…'
        : roomStatusOf(input.match, input.mineReady, input.peerSeen)
  }
}
