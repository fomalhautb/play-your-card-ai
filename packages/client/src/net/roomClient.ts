/**
 * 连房间对象的那条连接：序号对账、漏包重同步、把目录接回视图。
 *
 * 会话那一层（session.ts）只管握手和心跳，这一层是**协议里和对局有关的那几条规矩**
 *（协议 README「序号和重同步」）：
 *
 * 1. `seq` 从 1 开始按座位各算一串，只有 `match:started` 和 `match:events` 占号。
 * 2. 下一条的 `seq` 不等于「上一个 + 1」就是漏包了，发 `room:resync` 要一份快照，
 *    **这一批整条丢掉**——照它演出去会演出一段和局面对不上的动画。
 * 3. 重连也是发 `room:resync`：收到带座位的 `session:welcome` 之后就发。
 * 4. 服务端一律回 `match:snapshot`（完整视图 + 当前序号），**不补发漏掉的事件**。
 *
 * 还有一件是这一层独有的：`match:events` 里的视图**不带卡池**（一局只发一次，
 * 占一份视图九成体积），所以要用开局或最近一次快照存下来的那份 `attachCatalog` 回去。
 * 接回去之后往上传的一律是完整的 `PlayerView`，界面不用先想「这份有没有目录」。
 */

import type { Catalog, PlayerId, PlayerView } from '@ai-duel/core'
import type { NetworkCapability } from '@ai-duel/platform'
import type { ClientMessage, ServerMessage, SessionRejectedReason } from '@ai-duel/protocol'
import { attachCatalog } from '@ai-duel/protocol'
import type { MatchEventBatch } from '../match/driver'
import { openSession } from './session'

interface RoomHandlers {
  /** 握手成功，服务端分的座位。每次重连都会再来一次，座位不会变。 */
  onSeat(seat: PlayerId): void
  /** 一批要播的事件，视图已经补回目录。开局那条也走这里。 */
  onBatch(batch: MatchEventBatch): void
  /** 快照：整份换掉，不补演出。 */
  onSnapshot(view: PlayerView): void
  /** 上面几种之外的房间消息（`room:peer`、`room:closed`、`match:rejected`……），原样转出去。 */
  onMessage(message: ServerMessage): void
  /** 进不去房间，或者被顶号了。 */
  onRejected(reason: SessionRejectedReason, notice: string): void
  /** 这条连接断了，还在自动重连。 */
  onDown(): void
}

export interface RoomClientOptions {
  network: NetworkCapability
  url(): string
  token(): Promise<string>
  clientVersion?: string
  handlers: RoomHandlers
}

export interface RoomClient {
  /**
   * 发一条消息给房间。
   *
   * `session:hello` 和 `room:resync` 不走这儿——那两条是这一层自己的事，
   * 调用方发的是 `room:loadout` / `room:ready` / `room:leave` / `room:urge` / `match:command`。
   */
  send(message: ClientMessage): void
  close(): void
}

export function createRoomClient(options: RoomClientOptions): RoomClient {
  const { handlers } = options
  /** 手上最后一个序号。0 表示这一局一条都没收到过（重连时如实报给服务端记日志）。 */
  let lastSeq = 0
  /** 开局或最近一次快照里那份卡池。没有它就补不出完整视图。 */
  let catalog: Catalog | null = null
  /** 已经要过快照、还没等到。防止漏包之后每来一条 `match:events` 就再要一次。 */
  let resyncPending = false
  let closed = false

  const session = openSession({
    network: options.network,
    url: options.url,
    token: options.token,
    clientVersion: options.clientVersion,

    onWelcome(place) {
      // 连的是房间，收到的 place 不可能是大厅那种。真收到了说明地址连岔了，
      // 这时候什么都别做——按房间的规矩往下走只会拿到一个不存在的座位。
      if (place.kind !== 'room') return
      handlers.onSeat(place.seat)
      // 协议 README 第 4 条：连上、拿到带座位的 welcome 之后就要一份快照。
      // 对局还没开始时服务端回的是 `room:error not-in-match`，那是正常答复。
      requestResync()
    },

    onRejected(reason, notice) {
      closed = true
      handlers.onRejected(reason, notice)
    },

    onDown() {
      resyncPending = false
      handlers.onDown()
    },

    onMessage(message) {
      switch (message.type) {
        case 'match:started':
          // 一局重新开始：序号从头算，目录换成这一局冻住的那份（见协议的 view.ts）。
          lastSeq = message.seq
          catalog = message.view.catalog
          resyncPending = false
          handlers.onBatch({ events: message.events, view: message.view })
          break

        case 'match:events': {
          if (catalog === null || message.seq !== lastSeq + 1) {
            // 要么漏包了，要么这条比开局还早到（新开的页面接手一局打到一半的对局）。
            // 两种都只能等快照，这一批不往上传。
            requestResync()
            break
          }
          lastSeq = message.seq
          handlers.onBatch({ events: message.events, view: attachCatalog(message.view, catalog) })
          break
        }

        case 'match:snapshot':
          lastSeq = message.seq
          catalog = message.view.catalog
          resyncPending = false
          handlers.onSnapshot(message.view)
          break

        case 'room:closed':
          handlers.onMessage(message)
          /*
           * 收到它必须自己收掉连接。服务端关这条连接用的是 1000（正常关闭，
           * 见 server 的 lifecycle.ts），不在「业务拒绝」那一段里，
           * 底层会照常重连回去——然后撞上一个已经收摊的房间，
           * 玩家刚看到「这一局打完了」又被一条 `room-not-found` 盖成「进不去」。
           */
          close()
          break

        default:
          handlers.onMessage(message)
      }
    },
  })

  function requestResync(): void {
    if (closed || resyncPending) return
    resyncPending = true
    session.send({ type: 'room:resync', haveSeq: lastSeq })
  }

  function close(): void {
    closed = true
    session.close()
  }

  return {
    send(message) {
      if (closed) return
      session.send(message)
    },
    close,
  }
}
