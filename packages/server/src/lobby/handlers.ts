/**
 * 五条 `lobby:*` 消息各自怎么办。
 *
 * 大厅只干一件事：**把房间码交到玩家手上**。三条路（排队配对、私人开房、按码加入）
 * 走完都是同一条 `lobby:room`，玩家拿到码之后自己断开、另开一条连接去连房间对象
 * （协议 README「两条连接」）。大厅不分座位、不管牌组、更不碰对局——那些全是房间的事。
 *
 * 大厅连接**服务端不主动关**：玩家可能开完私人房还想再取消、再排队。
 * 什么时候断由客户端决定。
 */

import type { LobbyErrorReason, LobbyRoomOrigin, RoomCode } from '@ai-duel/protocol'
import { readSession, send } from '../net/session'
import { userTag } from './naming'
import type { LobbyStore } from './queue'

/** 一次消息处理要用到的大厅上下文。 */
export interface LobbyContext {
  ctx: DurableObjectState
  env: Env
  store: LobbyStore
}

/** 大厅报错。连接不关，玩家可以接着操作（协议的 `lobbyErrorSchema`）。 */
function sendLobbyError(ws: WebSocket, reason: LobbyErrorReason, notice: string): void {
  send(ws, { type: 'lobby:error', reason, notice })
}

/**
 * 把房间码发给某个账号**已经打完招呼**的每一条连接。
 *
 * 配对成功时对手不在「发消息给我这条连接」的路径上，只能按账号反查，所以要走标签。
 * 一个账号正常只有一条大厅连接（新的会顶掉旧的），多发一份到马上要断的连接没有害处。
 */
function sendRoom(
  ctx: DurableObjectState,
  userId: string,
  code: RoomCode,
  origin: LobbyRoomOrigin,
): void {
  for (const ws of ctx.getWebSockets(userTag(userId))) {
    if (readSession(ws)?.greeted === true) send(ws, { type: 'lobby:room', code, origin })
  }
}

/**
 * 摇一个码并把房间建出来。摇不出来返回 null，调用方回 `no-room-code`。
 *
 * 先摇码再动队列：摇不出来的话排队的人应该原样留在队里，等下一个人进来时再试一次。
 */
async function openRoom(
  lobby: LobbyContext,
  create: (code: RoomCode) => Promise<void>,
): Promise<RoomCode | null> {
  const now = Date.now()
  const code = lobby.store.allocateCode(now)
  if (code === null) return null
  await create(code)
  lobby.store.addRoom(code, now)
  return code
}

/**
 * `lobby:queue`：进全局匹配队列，凑够两个人就配对。
 *
 * 「先到的两个」——不按分数、不按段位分池，全局就一条队（《正式版架构》5.4）。
 *
 * 配对成功的那一刻两个人**都还连着大厅**（断线会当场出队，见 `handleDisconnect`），
 * 但两件事之间毕竟有个时间缝：万一其中一个正好在这一瞬间断了，他就收不到房间码，
 * 另一个会进到一个只有自己的房间里，等空房超时自己关掉（见 room/lifecycle.ts）。
 * 不为这条缝再加一层确认，因为确认本身也会有同样的缝。
 */
export async function handleQueue(
  lobby: LobbyContext,
  ws: WebSocket,
  userId: string,
): Promise<void> {
  if (lobby.store.isQueued(userId)) {
    sendLobbyError(ws, 'already-queued', '你已经在匹配队列里了')
    return
  }
  lobby.store.enqueue(userId, Date.now())
  send(ws, { type: 'lobby:queued' })

  const pair = lobby.store.firstTwo()
  if (pair === null) return
  const code = await openRoom(lobby, async (allocated) => {
    await lobby.env.MATCH_ROOM.getByName(allocated).setup({ players: pair })
  })
  if (code === null) {
    sendLobbyError(ws, 'no-room-code', '房间码摇不出来了，请稍后再试')
    return
  }
  for (const player of pair) {
    lobby.store.dequeue(player)
    sendRoom(lobby.ctx, player, code, 'queue')
  }
}

/** `lobby:cancel`：退出队列。不在队里说明界面和服务端的状态错开了，回 `not-queued`。 */
export function handleCancel(lobby: LobbyContext, ws: WebSocket, userId: string): void {
  if (!lobby.store.isQueued(userId)) {
    sendLobbyError(ws, 'not-queued', '你没有在匹配队列里')
    return
  }
  lobby.store.dequeue(userId)
  send(ws, { type: 'lobby:canceled' })
}

/**
 * `lobby:create`：开一个私人房，只占 0 号座，把码发给玩家去转告朋友。
 *
 * 顺手把他从匹配队列里拿掉：一个人不能同时在私人房里等朋友、又在队列里等配对，
 * 否则配对成功时他会同时拿到两个房间码。
 */
export async function handleCreate(
  lobby: LobbyContext,
  ws: WebSocket,
  userId: string,
): Promise<void> {
  const code = await openRoom(lobby, async (allocated) => {
    await lobby.env.MATCH_ROOM.getByName(allocated).reserve(allocated, userId)
  })
  if (code === null) {
    sendLobbyError(ws, 'no-room-code', '房间码摇不出来了，请稍后再试')
    return
  }
  lobby.store.dequeue(userId)
  send(ws, { type: 'lobby:room', code, origin: 'create' })
}

/**
 * `lobby:join`：按朋友给的码进房。
 *
 * 码先在大厅这张表里查一遍，查不到就到此为止——这正是「按码加入走大厅而不是直接连房间」
 * 的理由（协议 lobby.ts 开头）：打错一个数字不该凭空创建一个 Durable Object。
 * 表里有、房间自己说没有（比如刚好在这一瞬间收摊了），把这行删掉再回同样的错。
 */
export async function handleJoin(
  lobby: LobbyContext,
  ws: WebSocket,
  userId: string,
  code: RoomCode,
): Promise<void> {
  if (!lobby.store.hasLiveRoom(code, Date.now())) {
    sendLobbyError(ws, 'room-not-found', '没有这个房间，检查一下房间码')
    return
  }
  const outcome = await lobby.env.MATCH_ROOM.getByName(code).join(userId)
  if (outcome === 'room-not-found') {
    lobby.store.releaseRoom(code)
    sendLobbyError(ws, 'room-not-found', '没有这个房间，检查一下房间码')
    return
  }
  if (outcome === 'room-full') {
    sendLobbyError(ws, 'room-full', '这个房间已经满了')
    return
  }
  lobby.store.dequeue(userId)
  send(ws, { type: 'lobby:room', code, origin: 'join' })
}

/** 客户端发了一条大厅看不懂的 `lobby:join`（多半是没填房间码），告诉它缺什么。 */
export function sendMissingCode(ws: WebSocket): void {
  sendLobbyError(ws, 'no-room-code', '没有可用的房间码')
}

/**
 * 一条大厅连接没了：把这个人从队列里拿掉。
 *
 * 先确认这个**账号**是真的走了：重连时新连接会顶掉旧的，旧连接的关闭回调随后才到，
 * 这时候他已经有一条新连接在大厅里了，不查这一下每次重连都会把人踢出队列。
 */
export function handleDisconnect(lobby: LobbyContext, userId: string, ws: WebSocket): void {
  const others = lobby.ctx.getWebSockets(userTag(userId)).filter((other) => other !== ws)
  if (others.length > 0) return
  lobby.store.dequeue(userId)
}
