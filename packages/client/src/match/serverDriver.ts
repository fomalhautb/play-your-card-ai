/**
 * 联机 driver：规则在房间 Durable Object 里跑，这一端只发指令、只收裁剪过的事件和视图。
 *
 * 《正式版架构》5.6 那条「客户端只留两个 driver」的联机那一半。
 * 旧版的房主 / 客人两个实现在这里合成一个：权威服务端之后两边完全对称，
 * 谁都不跑 `execute`，谁也不替对方转发。
 *
 * 分工：
 * - 序号对账、漏包重同步、把卡池接回视图 → net/roomClient.ts
 * - 握手、心跳、版本、断线上报 → net/session.ts
 * - 订阅规矩和快照引用 → match/driverCore.ts
 *
 * 这个文件只做一件事：把房间来的消息翻译成 `MatchView` 的几个字段。
 */

import type { CardId, HeroId, PlayerView } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import type { RoomCode, ServerMessage } from '@ai-duel/protocol'
import { roomUrl } from '../net/endpoints'
import { createRoomClient } from '../net/roomClient'
import type { MatchDriver, MatchStatus, PeerState } from './driver'
import { createDriverCore } from './driverCore'

export interface ServerDriverOptions {
  platform: Platform
  /**
   * 每次（重）连现取一张短时效 JWT。
   *
   * 由调用方给，因为「拿会话去换 token」是账号那一层的事（`/api/auth/token`，
   * 见 server README「账号与鉴权」）。driver 只知道有这么一张纸要交上去。
   */
  tokenProvider(): Promise<string>
  code: RoomCode
  /**
   * 服务端的 http(s) 源。生产环境前端和服务端是同一个 Worker、同一个域名，
   * 所以默认用当前页面的 origin；本地开发是两个进程，由应用入口传 wrangler 的地址。
   */
  origin?: string
  clientVersion?: string
}

/**
 * 联机 driver 比通用接口多出来的三件事，都属于「房间成员关系」而不是「对局」。
 *
 * 单机没有房间也就没有这三样，所以它们不在 `MatchDriver` 里：
 * 放进去的话 `localDriver` 得凭空实现三个空方法。房间页（迁移第 27b 条）用的是这个类型。
 */
export interface ServerDriver extends MatchDriver {
  /** 报上本方牌组和英雄。**不报顺序**，洗牌是服务端的事。 */
  loadout(deck: CardId[], hero: HeroId | null): void
  /** 我准备好了。双方都就绪服务端才开局。 */
  ready(): void
  /** 我不打了。和掉线不是一回事：这条会让房间当场收摊。 */
  leave(): void
}

/**
 * 这个 driver 是不是联机那一个。
 *
 * 界面拿它决定「离开对局」时要不要先跟服务端打个招呼：`MatchSession` 里存的是通用的
 * `MatchDriver`，而 `leave()` 只有联机有。判方法在不在而不是加一个 `kind` 字段，
 * 理由同 `isLocalDriver`——「有没有这个口子」本来就是这里唯一要问的事。
 */
export function isServerDriver(driver: MatchDriver): driver is ServerDriver {
  return 'loadout' in driver && 'ready' in driver && 'leave' in driver
}

/** 局面自己说了算的那部分状态；中断（aborted）由 `room:closed` 和握手拒绝决定。 */
function statusOf(view: PlayerView): MatchStatus {
  return view.phase === 'finished' ? 'finished' : 'playing'
}

/**
 * 拿一句能显示给玩家的话。
 *
 * `notice` 允许是空串（协议的 `noticeSchema`：服务端偷懒不写也别让整条消息作废），
 * 空了就退回用 `reason` 顶上——界面上出现一个没有任何字的中断原因比出现一个英文枚举更糟。
 */
function noticeOr(notice: string, reason: string): string {
  return notice.length > 0 ? notice : reason
}

export function createServerDriver(options: ServerDriverOptions): ServerDriver {
  const origin = options.origin ?? window.location.origin
  const core = createDriverCore({
    view: null,
    seat: null,
    status: 'connecting',
    lastRejection: null,
    abortReason: null,
    // 还没连上，消息当然送不到。第一份 `match:started` 或 `match:snapshot` 到手才算通。
    link: 'down',
    peer: null,
  })

  /**
   * 对局收场：连接是**故意**关掉的，所以链路也一并标成断的。
   *
   * 界面判断「要不要显示正在重连」的口径因此只有一条：`status` 还在打、而 `link` 是断的。
   */
  function finish(status: MatchStatus, abortReason: string | null): void {
    core.patch({ status, abortReason, link: 'down' })
  }

  /**
   * 对手状态没变就把原来那个对象传回去。
   *
   * 服务端每次都发全量的三项（协议的 `roomPeerSchema`），而 `patch` 是浅比较：
   * 不复用同一个对象的话，每条 `room:peer` 都会换一个新引用，界面白重渲染一轮。
   */
  function mergePeer(next: PeerState): PeerState {
    const current = core.getSnapshot().peer
    if (current === null) return next
    const same =
      current.online === next.online &&
      current.loaded === next.loaded &&
      current.ready === next.ready
    return same ? current : next
  }

  function handle(message: ServerMessage): void {
    switch (message.type) {
      case 'room:peer':
        core.patch({
          peer: mergePeer({
            online: message.online,
            loaded: message.loaded,
            ready: message.ready,
          }),
        })
        break

      case 'room:closed':
        // 正常打完是 finished（有赢家），另外两种是中断（没有赢家）。
        if (message.reason === 'match-over') finish('finished', null)
        else finish('aborted', noticeOr(message.notice, message.reason))
        break

      case 'room:error':
        /*
         * `not-in-match` 是握手时那条 `room:resync` 的正常答复——对局还没开始，
         * 服务端没有快照可给。它不是玩家做错了什么，不该弹到界面上。
         *
         * 反过来它是**这一刻唯一能证明链路通了的东西**：房间页在开局前一条事件都收不到，
         * 光等 `match:started` 的话 `link` 会一直挂在 `'down'` 上，界面于是从进房那一刻
         * 就写着「正在重连」。这条答复说明消息送得到、也送得回；而「屏幕上的局面是旧的」
         * 那种担心在这儿不存在——压根还没有局面。
         * 对局中途重连时服务端回的是 `match:snapshot` 而不是它，所以那条路的口径没变
         *（重连要等快照到手才算通，见下面 onSnapshot）。
         *
         * 其余几种（牌组不合法、重复就绪、借座位）都是要让玩家看见的。
         */
        if (message.reason === 'not-in-match') {
          core.patch({ link: 'ok' })
          break
        }
        core.patch({ lastRejection: noticeOr(message.notice, message.reason) })
        break

      case 'match:rejected':
        core.patch({ lastRejection: message.reason })
        /*
         * 还要往事件流里补一条 `COMMAND_REJECTED`，和单机那一端对称（见 localDriver 的
         * publish）。演出编排层靠「上一条指令有结果了」把出牌解锁：玩家按下去那一刻它就
         * 记上 `awaiting`，只有收到一批事件才清掉（见 canvas 的 director）。
         * 服务端把这条回执单独回给发指令的那条连接、不混在 `match:events` 里
         *（`filterEvent` 对它一律返回 null，见协议的 matchRejectedSchema），
         * 所以被拒时这一端一批事件都收不到——不补的话 `awaiting` 一直挂着、手牌一直锁着，
         * **一次被拒之后整局都出不了牌**，那条红字提示也没机会播。
         *
         * 局面没变（被拒的指令什么都没改），所以带的还是手上这一份视图。
         * 第一份视图都还没到的时候不补：那时演出层还没开始，也就没有锁要解。
         */
        {
          const view = core.getSnapshot().view
          if (view !== null) {
            core.emitBatch({ events: [{ type: 'COMMAND_REJECTED', reason: message.reason }], view })
          }
        }
        break

      default:
        // 大厅那几种消息不该出现在房间连接上，出现了也不关这条 driver 的事。
        break
    }
  }

  const room = createRoomClient({
    network: options.platform.network,
    url: () => roomUrl(origin, options.code),
    token: options.tokenProvider,
    clientVersion: options.clientVersion,
    handlers: {
      onSeat: (seat) => core.patch({ seat }),

      onBatch(batch) {
        // 先把局面换成这批之后的真相，再把事件交给演出层：
        // 界面读的是快照，动画读的是事件，两者节奏不同（见 driver.ts）。
        // 收到新一批就说明上一条指令有结果了，旧的拒绝提示翻篇。
        core.patch({
          view: batch.view,
          status: statusOf(batch.view),
          lastRejection: null,
          link: 'ok',
        })
        core.emitBatch(batch)
      },

      onSnapshot(view) {
        // 快照不补演出（协议 README 第 5 条）：漏掉的动画不再演，直接把画面画成这个样子。
        core.patch({ view, status: statusOf(view), link: 'ok' })
      },

      onMessage: handle,

      onRejected: (reason, notice) => finish('aborted', noticeOr(notice, reason)),

      // 断线期间局面还留在屏幕上，只是消息送不到了，所以只动 link 不动 status。
      onDown: () => core.patch({ link: 'down' }),
    },
  })

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,

    send(command) {
      room.send({ type: 'match:command', command })
    },

    loadout(deck, hero) {
      room.send({ type: 'room:loadout', deck, hero })
    },

    ready() {
      room.send({ type: 'room:ready' })
    },

    leave() {
      room.send({ type: 'room:leave' })
    },

    dispose() {
      room.close()
    },
  }
}
