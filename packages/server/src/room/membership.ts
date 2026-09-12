/**
 * 房间成员这一层：谁坐进来、装载牌组、就绪、离开、重同步，
 * 以及「双方都就绪」之后开局。
 *
 * 和 commands.ts 的分工按协议的两个前缀切：`room:` 是成员关系（开局前后都要用），
 * `match:` 是对局本身（只有开局之后才有意义）。
 * 座位是怎么占上的（大厅那三条路）在下面 `setupRoom` / `reserveRoom` / `joinRoom` 三个函数里。
 */

import { createCatalog, HEROES, isLegalDeck, QUESTION_POOL } from '@ai-duel/content'
import type { PlayerId } from '@ai-duel/core'
import { createGame, other } from '@ai-duel/core'
import type { ClientMessage } from '@ai-duel/protocol'
import { dispatchStarted, sendSnapshot } from './dispatch'
import { closeRoom, scheduleIdleCheck } from './lifecycle'
import { SEATS, seatOnline, sendRoomError, sendToSeat } from './session'
import type { RoomContext, RoomRecord, RoomStore, SeatLoadout } from './state'
import { seatOf } from './state'

/** 客户端发上来的那条 `room:loadout`。protocol 只导出了 schema，类型从消息联合里挑出来。 */
type LoadoutMessage = Extract<ClientMessage, { type: 'room:loadout' }>

/**
 * 这副牌组和英雄能不能上桌。能就返回规范化之后的装载，不能返回 null。
 *
 * protocol 那边只挡了「一条消息塞十万张牌」这种形状问题（见 `roomLoadoutSchema`），
 * 真正的构筑规则要查内容表：张数不对、同名超量、牌不在卡池里、英雄还没实装，都不让开局。
 * 放过去的话引擎会拿到一副打不动的牌，或者玩家能带上一张设计稿都没实装的英雄。
 *
 * 牌组那半调 content 的 `isLegalDeck`，和客户端构筑页放行的是同一条规则——
 * 两边各写一份的话，客户端能编出来、服务端不让开局的牌组迟早会出现。
 * 英雄这半留在这儿：它不进牌组，规则也只有「实装了没有」一条。
 */
function validateLoadout(loadout: LoadoutMessage): SeatLoadout | null {
  if (!isLegalDeck(loadout.deck)) return null
  // hero 为 null 是「这一方不带英雄」，是合法的（见 core 的 PlayerSetup）。
  if (loadout.hero !== null && HEROES[loadout.hero].comingSoon === true) return null
  return { deck: [...loadout.deck], hero: loadout.hero }
}

/**
 * 把对手此刻的状态发给双方，每次都是完整的三项。
 *
 * 每次发全量而不是发变化，是协议定的（见 `roomPeerSchema`）：
 * 客户端要的是当前全貌，全量就不用管消息顺序，也不会漏掉某一次变化。
 * 连上、断开、装载、就绪之后都要调一次。`exclude` 见 session.ts 的 `seatOnline`。
 */
export function broadcastPeer(room: RoomContext, exclude: WebSocket | null = null): void {
  for (const seat of SEATS) {
    const peer = other(seat)
    sendToSeat(room.ctx, seat, {
      type: 'room:peer',
      seat: peer,
      online: seatOnline(room.ctx, peer, exclude),
      loaded: room.record.loadout[peer] !== null,
      ready: room.record.ready[peer],
    })
  }
}

/** 洗牌种子。用 `crypto.getRandomValues` 而不是 `Math.random`：牌序是隐藏信息，别让人猜得出来。 */
function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!
}

/**
 * 双方都装载完、都就绪了就开局，否则什么都不做。
 *
 * 牌序、题序、先手全由服务端掷（`seed` 在这儿生成），客户端一个字都插不上手——
 * 让客户端报顺序等于让它决定自己下一张摸什么（见 `roomLoadoutSchema`）。
 *
 * `name` 暂时直接用账号 id：显示名要等第 25 条接上 better-auth 才有地方取
 * （协议说得很清楚，显示名从账号来，客户端说了不算）。
 */
function startIfReady(room: RoomContext): void {
  const { record } = room
  const [first, second] = record.loadout
  if (first === null || second === null) return
  if (!record.ready[0] || !record.ready[1]) return
  if (room.store.game() !== null) return

  // 私人房在朋友进来之前 1 号座位是 null。没人坐就没人装载，走不到这儿，
  // 这一句是让类型收窄，顺带兜住「有人绕过 join 直接改了记录」这种不该发生的情况。
  const [firstName, secondName] = record.players
  if (secondName === null) return

  const result = createGame({
    seed: newSeed(),
    catalog: createCatalog(),
    questionPool: QUESTION_POOL,
    players: [
      { name: firstName, deck: first.deck, hero: first.hero },
      { name: secondName, deck: second.deck, hero: second.hero },
    ],
  })
  room.store.saveGame(result.state)
  dispatchStarted(room.ctx, record, result.state, result.events)
  room.store.saveRoom(record)
}

/** `room:loadout`。重复装载直接拒，不让人开局前反复改牌组把状态搅乱。 */
export function handleLoadout(
  room: RoomContext,
  ws: WebSocket,
  seat: PlayerId,
  message: LoadoutMessage,
): void {
  if (room.record.loadout[seat] !== null) {
    sendRoomError(ws, 'already-loaded', '你已经装载过牌组了')
    return
  }
  const loadout = validateLoadout(message)
  if (loadout === null) {
    sendRoomError(ws, 'bad-loadout', '这副牌组不合法')
    return
  }
  room.record.loadout[seat] = loadout
  room.store.saveRoom(room.record)
  broadcastPeer(room)
  startIfReady(room)
}

/** `room:ready`。没装载就就绪要拒：不然开局时拿不到牌组。 */
export function handleReady(room: RoomContext, ws: WebSocket, seat: PlayerId): void {
  if (room.record.ready[seat]) {
    sendRoomError(ws, 'already-ready', '你已经就绪了')
    return
  }
  if (room.record.loadout[seat] === null) {
    sendRoomError(ws, 'bad-loadout', '先装载牌组再就绪')
    return
  }
  room.record.ready[seat] = true
  room.store.saveRoom(room.record)
  broadcastPeer(room)
  startIfReady(room)
}

/**
 * `room:leave`：我不打了。
 *
 * 和掉线不是一回事——掉线只是暂时的，对手会看到 `room:peer` 的 online 变 false 然后等重连；
 * 这条是明确退出，房间当场收摊。
 */
export async function handleLeave(room: RoomContext): Promise<void> {
  await closeRoom(room, 'peer-left', '对手离开了房间')
  room.store.saveRoom(room.record)
}

/**
 * `room:resync`：要一份快照。重连之后发，或者发现漏包时发。
 *
 * `haveSeq` 不拿来分支，一律回完整快照（协议 README 第 5 条），
 * 它只是给日志用的——漏了多少、断了多久只有客户端知道。
 */
export function handleResync(
  room: RoomContext,
  ws: WebSocket,
  seat: PlayerId,
  haveSeq: number,
): void {
  const state = room.store.game()
  if (state === null) {
    sendRoomError(ws, 'not-in-match', '对局还没开始')
    return
  }
  console.log(`房间重同步：座位 ${seat} 手上是 ${haveSeq}，服务端在 ${room.record.seq[seat]}`)
  sendSnapshot(ws, room.record, state, seat)
}

/**
 * 大厅那三条路进房间的结果。取值和协议的 `lobbyErrorReasonSchema` 对得上，
 * 大厅拿到它直接当 `lobby:error` 的 reason 用，不用再翻译一道。
 */
export type JoinOutcome = 'ok' | 'room-full' | 'room-not-found'

/** 建好的房间要排第一次空房检查：开了房一直没人来，到点自己关掉（见 lifecycle.ts）。 */
async function openRoom(
  ctx: DurableObjectState,
  store: RoomStore,
  players: [string, string | null],
): Promise<void> {
  const record: RoomRecord = {
    players,
    loadout: [null, null],
    ready: [false, false],
    seq: [0, 0],
    closed: null,
  }
  store.saveRoom(record)
  await scheduleIdleCheck(ctx, store)
}

/**
 * 排队配对成功：两个人一起到，两个座位一次写满。
 *
 * 房间已经有了就直接忽略而不是重建：房间码有可能撞上一个还在打的房间，
 * 重建会把正在进行的对局抹掉。
 */
export async function setupRoom(
  ctx: DurableObjectState,
  store: RoomStore,
  players: [string, string],
): Promise<void> {
  if (store.room() !== null) return
  await openRoom(ctx, store, players)
}

/** 私人开房第一步：开房的人先占 0 号座，1 号座空着等朋友（`join` 来补）。 */
export async function reserveRoom(
  ctx: DurableObjectState,
  store: RoomStore,
  userId: string,
): Promise<void> {
  if (store.room() !== null) return
  await openRoom(ctx, store, [userId, null])
}

/**
 * 私人开房第二步：朋友按码进来占 1 号座。
 *
 * 同一个人再来一次返回 `ok`（他本来就在房里）：大厅那边可能因为客户端重发
 * 或者界面重进而调第二次，让它幂等好过让玩家看见一条「房间满了」。
 */
export function joinRoom(store: RoomStore, userId: string): JoinOutcome {
  const record = store.room()
  // 房间没建过，或者已经收摊了——两种对要进来的人来说都是「这个码没用了」。
  if (record === null || record.closed !== null) return 'room-not-found'
  if (seatOf(record, userId) !== null) return 'ok'
  if (record.players[1] !== null) return 'room-full'
  record.players[1] = userId
  store.saveRoom(record)
  return 'ok'
}
