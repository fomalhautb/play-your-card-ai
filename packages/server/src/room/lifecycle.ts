/**
 * 房间的收尾：收摊（谁触发的都走这里）和「空房太久自己关掉」。
 *
 * 房间有三种结束方式，协议里的 `room:closed` 就这三个 reason：
 * `match-over`（打完了，见 commands.ts）、`peer-left`（有人明说不打了，见 membership.ts）、
 * `idle-timeout`（下面这一段）。三种都要做同样的收尾动作，所以只有 `closeRoom` 一个出口。
 */

import type { RoomClosedReason } from '@ai-duel/protocol'
import { LOBBY_NAME } from '../lobby/naming'
import { cancelAlarms, scheduleAlarm } from './alarms'
import { SEATS, seatOnline, seatTag, sendToSeat } from './session'
import { type RoomContext, roomCodeOf } from './state'

/**
 * 空房多久自己关掉。
 *
 * 盯的是「一个人都没连着」，不是「没人说话」：对局中途双方各自发呆是常事，
 * 房间不该因为安静就把人赶走。旧转发器那个 `PEER_GRACE 60_000` 是另一回事——
 * 那是客户端判「对手是真走了还是掉线了」的宽限期，不是房间自己的寿命。
 * 十分钟是留给「开了私人房去发码给朋友」和「地铁进隧道断一会儿」的余量。
 */
const IDLE_TIMEOUT_MS = 10 * 60_000

/** 排下一次空房检查。建房时排第一次，之后每次检查完发现还有人就再续一次。 */
export async function scheduleIdleCheck(
  ctx: DurableObjectState,
  store: RoomContext['store'],
): Promise<void> {
  await scheduleAlarm(ctx, store, 'idle', Date.now() + IDLE_TIMEOUT_MS)
}

/**
 * 空房检查到点了：还有人连着就再续一次，一个人都没有就收摊。
 *
 * 只在到点这一刻看一眼在不在线，不去记「最后一个人是什么时候断的」：
 * 那样每次连接开关都要写一次 SQLite，而这里最多让房间多活一个检查周期，
 * 对一个已经没人的房间来说无所谓。
 */
export async function checkIdle(room: RoomContext): Promise<void> {
  if (SEATS.some((seat) => seatOnline(room.ctx, seat))) {
    await scheduleIdleCheck(room.ctx, room.store)
    return
  }
  await closeRoom(room, 'idle-timeout', '房间太久没人，已经关掉了')
  room.store.saveRoom(room.record)
}

/**
 * 房间收摊：两边发一条 `room:closed`，关掉连接，撤掉定时任务，把房间码还给大厅。
 *
 * `closed` 写进记录是为了挡住重连：协议说收到 `room:closed` 就别再重连，
 * 但那是客户端的规矩，服务端这边得自己有一份，不然一个不守规矩的客户端能一直连回来。
 * **记录本身由调用方存盘**（它手上那份 `record` 往往还有别的改动要一起写）。
 *
 * 关闭码用 1000（正常关闭）：这不是拒绝，是这局结束了，
 * 4000 区间那几个码都是「你进不来」的意思，用在这里会让客户端误判。
 */
export async function closeRoom(
  room: RoomContext,
  reason: RoomClosedReason,
  notice: string,
): Promise<void> {
  const { ctx, record } = room
  record.closed = reason
  for (const seat of SEATS) sendToSeat(ctx, seat, { type: 'room:closed', reason, notice })
  for (const seat of SEATS) {
    for (const ws of ctx.getWebSockets(seatTag(seat))) ws.close(1000, reason)
  }
  // 两种定时任务一起撤掉：房间已经没有下一步了，再被叫醒也只是空跑一趟。
  await cancelAlarms(ctx, room.store, 'quiz', 'idle')
  await releaseCode(room)
}

/**
 * 把房间码还给大厅，好让它能再发给别人。
 *
 * 出错只记日志不往外抛：码没还回去顶多是一万个码里少一个能用（大厅摇码时会绕开它），
 * 而收摊这件事已经做完了——为了一次 RPC 失败把 `room:closed` 的流程炸掉不划算。
 *
 * 注意**收摊不能发生在大厅正等着的那几个 RPC 里**（`setup` / `reserve` / `join`）：
 * 那会变成大厅等房间、房间等大厅。眼下收摊只由客户端消息和 alarm 触发，
 * 那三个 RPC 一行都不碰它，往里加逻辑时别把这条破了。
 */
async function releaseCode(room: RoomContext): Promise<void> {
  const code = roomCodeOf(room.ctx)
  try {
    await room.env.LOBBY.getByName(LOBBY_NAME).release(code)
  } catch (error) {
    console.log(`房间码 ${code} 没能还给大厅：${String(error)}`)
  }
}
