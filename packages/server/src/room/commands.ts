import type { Command, PlayerId } from '@ai-duel/core'
import { execute } from '@ai-duel/core'
import type { PlayerCommand } from '@ai-duel/protocol'
import { closeRoom, dispatchEvents } from './dispatch'
import { send, sendRoomError } from './session'
import type { RoomRecord, RoomStore } from './state'

/**
 * 指令进来之后到事件发出去之间的那一段：核座位、跑引擎、存盘、分发。
 *
 * ## 座位核对是这一层唯一在做的「防作弊」
 *
 * 指令里带着一个 `player` 字段，schema 看不见「谁在发」，所以它是不是发送方自己的座位
 * 只能在这里对（协议 README「指令：谁能发什么」最后一条，《正式版架构》6.7 的作弊测试）。
 * 不对就整条丢掉，连引擎都不进——引擎自己不做来源限制，它只认状态和指令。
 *
 * 另外两道闸不在这个文件里：
 * - `SUBMIT_ANSWERS` 和 `DEBUG_*` 由 `playerCommandSchema` 在**解析层**就挡掉了
 *   （`matchCommandSchema` 的载荷只认那四种玩家操作），根本走不到这儿；
 * - 隐藏信息由 `filterEvent` / `viewFor` 在**下发层**挡掉（见 dispatch.ts）。
 */

/** 一次消息处理要用到的房间上下文。`record` 是从 SQLite 读出来的那份，改完由这里存回去。 */
export interface RoomContext {
  ctx: DurableObjectState
  store: RoomStore
  record: RoomRecord
}

/**
 * 执行一条指令，把结果发出去。
 *
 * 服务端自己发的 `SUBMIT_ANSWERS` 也走这里（见 MatchRoom 的 `submitAnswers`），
 * 所以参数是 core 的 `Command` 而不是 `PlayerCommand`——这个函数不管来源，
 * 来源在调用它之前就该判完了。
 *
 * `COMMAND_REJECTED` 不进事件批：`filterEvent` 对它一律返回 null（见 core 的 view.ts），
 * 那是对一条指令的回执、不是局面上发生的事。所以这里先把它挑出来单独回给发指令那一方，
 * 剩下的再交给 `dispatchEvents`。被拒时引擎返回的状态和原来一样，
 * 照存一遍无害，也省得为「拒了没有」分两条路。
 */
export function runCommand(room: RoomContext, command: Command, from: WebSocket | null): void {
  const state = room.store.game()
  if (state === null) return

  const result = execute(state, command)
  for (const event of result.events) {
    if (event.type !== 'COMMAND_REJECTED') continue
    if (from !== null) send(from, { type: 'match:rejected', reason: event.reason })
  }

  room.store.saveGame(result.state)
  dispatchEvents(room.ctx, room.record, result.state, result.events)

  // 一局打完就收摊。顺序要紧：`room:closed` 必须排在带 GAME_OVER 的那批事件后面，
  // 否则客户端还没来得及播完终局演出连接就断了。
  if (result.events.some((event) => event.type === 'GAME_OVER')) {
    closeRoom(room.ctx, room.record, 'match-over', '这一局打完了')
  }
  room.store.saveRoom(room.record)
}

/**
 * 客户端发上来的 `match:command`。
 *
 * 对局还没开始（或已经结束）时回 `not-in-match`：这时候 SQLite 里根本没有局面，
 * 拿什么都算不出来。
 */
export function handlePlayerCommand(
  room: RoomContext,
  ws: WebSocket,
  seat: PlayerId,
  command: PlayerCommand,
): void {
  if (room.store.game() === null) {
    sendRoomError(ws, 'not-in-match', '对局还没开始')
    return
  }
  if (command.player !== seat) {
    sendRoomError(ws, 'not-your-seat', '这不是你的座位')
    return
  }
  runCommand(room, command, ws)
}
