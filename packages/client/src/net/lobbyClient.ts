/**
 * 连大厅对象的那条连接。大厅只干一件事：**把房间码交到玩家手上**。
 *
 * 三条路（排队配对、私人开房、按码加入）走完都是同一条 `lobby:room`
 *（协议的 lobby.ts），所以这里也就三个返回房间码的方法，加一个退队的。
 * 拿到码之后**自己断开**去连房间：大厅和房间是两个 Durable Object，
 * 一条连接跨不过去，而且服务端不会替客户端关这条（server 的 handlers.ts）。
 *
 * ## 为什么用 Promise 而不是回调
 *
 * 「点开始匹配 → 等 → 拿到房间码」在界面上就是一次 await：中间的 `lobby:queued`
 * 只是入队回执，没有分支要走。排队可能等很久，但等多久和形状无关。
 *
 * ## 断线就当这次请求失败
 *
 * 服务端在连接断掉的那一刻就把人**移出队列**（server 的 `handleDisconnect`），
 * 所以重连之后干等是等不到房间码的。与其让 Promise 永远挂着，不如当场 reject，
 * 让界面把按钮改回「开始匹配」。
 */

import type { NetworkCapability } from '@ai-duel/platform'
import type { LobbyErrorReason, RoomCode } from '@ai-duel/protocol'
import { openSession } from './session'

/** 一次大厅请求为什么没成。`reason` 是给代码 switch 的，`message` 是可以直接显示的中文。 */
export class LobbyError extends Error {
  readonly reason: LobbyErrorReason | 'rejected' | 'link-down' | 'closed' | 'superseded'

  constructor(reason: LobbyError['reason'], notice: string) {
    // notice 允许是空串（协议的 `noticeSchema`），空了就退回用 reason 当文案，
    // 免得界面上出现一个没有任何字的报错。
    super(notice.length > 0 ? notice : reason)
    this.name = 'LobbyError'
    this.reason = reason
  }
}

export interface LobbyClientOptions {
  network: NetworkCapability
  url(): string
  token(): Promise<string>
  clientVersion?: string
}

export interface LobbyClient {
  /** 进全局匹配队列。配上人才 resolve，可能要等很久。 */
  joinQueue(): Promise<RoomCode>
  /** 退出队列。同时会让还挂着的 `joinQueue()` 以 `'closed'` 失败。 */
  cancel(): Promise<void>
  /** 开一个私人房，拿到码发给朋友。 */
  createRoom(): Promise<RoomCode>
  /** 按朋友给的码进房。 */
  joinRoom(code: RoomCode): Promise<RoomCode>
  /** 主动断开大厅。挂着的请求全部以 `'closed'` 失败。 */
  close(): void
}

interface Waiter<T> {
  resolve(value: T): void
  reject(error: LobbyError): void
}

export function createLobbyClient(options: LobbyClientOptions): LobbyClient {
  /*
   * 两个等待位而不是一个队列：能挂起的请求只有两种——等房间码的（三条路共用一个位置，
   * 因为三条路的答复都是同一条 `lobby:room`，服务端也没给回执带上「这是回哪一条」的标记）
   * 和等退队回执的。同一时刻各自最多一个。
   */
  let roomWaiter: Waiter<RoomCode> | null = null
  let cancelWaiter: Waiter<void> | null = null

  function failAll(error: LobbyError): void {
    const room = roomWaiter
    const canceled = cancelWaiter
    roomWaiter = null
    cancelWaiter = null
    room?.reject(error)
    canceled?.reject(error)
  }

  const session = openSession({
    network: options.network,
    url: options.url,
    token: options.token,
    clientVersion: options.clientVersion,

    // 大厅的 welcome 没有座位也没有别的信息，进门这件事本身就是全部内容：
    // session 那一层会在这一刻把压着的请求放出去。
    onWelcome() {},

    onRejected(reason, notice) {
      failAll(new LobbyError(reason === 'superseded' ? 'superseded' : 'rejected', notice))
    },

    onDown() {
      failAll(new LobbyError('link-down', '和大厅断开了，请重试'))
    },

    onMessage(message) {
      switch (message.type) {
        case 'lobby:room': {
          const waiter = roomWaiter
          roomWaiter = null
          waiter?.resolve(message.code)
          // 码到手了，这条连接没别的用处。协议里进房间要另开一条连接。
          close()
          break
        }
        case 'lobby:canceled': {
          const waiter = cancelWaiter
          cancelWaiter = null
          waiter?.resolve()
          // 退了队就等不到房间码了，挂着的那个请求要有个了断。
          const room = roomWaiter
          roomWaiter = null
          room?.reject(new LobbyError('closed', '已经退出匹配队列'))
          break
        }
        case 'lobby:error':
          /*
           * 一条 `lobby:error` 没说自己是回哪一次请求的（协议里没有关联 id），
           * 所以挂着的全部照它失败。这不是偷懒：大厅的五种错都意味着
           * 「界面认为的状态和服务端不一样」，协议明说这时该以服务端为准把按钮改回去，
           * 而不是留着某个请求继续等一个不会来的答复。
           */
          failAll(new LobbyError(message.reason, message.notice))
          break
        default:
          // `lobby:queued` 是入队回执，房间码还在后头；房间那几种消息不该出现在这条连接上。
          break
      }
    },
  })

  function requestRoom(send: () => void): Promise<RoomCode> {
    return new Promise<RoomCode>((resolve, reject) => {
      const previous = roomWaiter
      roomWaiter = { resolve, reject }
      previous?.reject(new LobbyError('closed', '这次请求被新的请求取代了'))
      send()
    })
  }

  function close(): void {
    session.close()
    failAll(new LobbyError('closed', '大厅连接已关闭'))
  }

  return {
    joinQueue: () => requestRoom(() => session.send({ type: 'lobby:queue' })),
    createRoom: () => requestRoom(() => session.send({ type: 'lobby:create' })),
    joinRoom: (code) => requestRoom(() => session.send({ type: 'lobby:join', code })),

    cancel() {
      return new Promise<void>((resolve, reject) => {
        const previous = cancelWaiter
        cancelWaiter = { resolve, reject }
        previous?.reject(new LobbyError('closed', '这次请求被新的请求取代了'))
        session.send({ type: 'lobby:cancel' })
      })
    },

    close,
  }
}
