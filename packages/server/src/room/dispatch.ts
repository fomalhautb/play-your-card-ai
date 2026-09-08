import type { GameEvent, GameState, PlayerId } from '@ai-duel/core'
import { filterEvent, viewFor } from '@ai-duel/core'
import { stripCatalog } from '@ai-duel/protocol'
import { send } from '../net/session'
import { SEATS, sendToSeat } from './session'
import type { RoomRecord } from './state'

/**
 * 一批事件怎么变成两条 `match:events` 发出去，以及序号怎么走。
 *
 * 每条事件对每个座位各过一遍 `filterEvent`（对手的手牌、题目答案在这里就没了），
 * 局面各算一份 `viewFor`。两边收到的东西因此是不一样的，这正是需求第 6 条要的：
 * 隐藏信息压根不上电线，客户端想作弊也没有可作的料。
 *
 * ## 序号按座位各算一串
 *
 * 协议 README「序号和重同步」第 1、2 条：`seq` 从 1 开始、每个座位一串，
 * 只有 `match:started` 和 `match:events` 占号。
 * 一批事件被 `filterEvent` 对某一方过滤成空时那一方**整条不发**，
 * 所以两串号会走岔——这是设计如此，不是 bug：不发空包比为了对齐编号发空包省事得多。
 */

/** 这批事件里这个座位看得见的那些。全看不见就是空数组。 */
function visibleTo(events: readonly GameEvent[], seat: PlayerId): GameEvent[] {
  const visible: GameEvent[] = []
  for (const event of events) {
    const filtered = filterEvent(event, seat)
    if (filtered !== null) visible.push(filtered)
  }
  return visible
}

/**
 * 开局：两边各发一条 `match:started`，序号都从 1 起。
 *
 * 视图是**完整的** `PlayerView`（带 catalog），客户端存下这份目录，
 * 之后每批 `match:events` 靠它补全（见 protocol 的 view.ts）。
 *
 * 这里不像下面那样判「过滤成空就不发」：开局事件里的抛硬币双方都看得见，
 * 而且客户端要靠这条拿座位号和目录，一定得发。
 */
export function dispatchStarted(
  ctx: DurableObjectState,
  record: RoomRecord,
  state: GameState,
  events: readonly GameEvent[],
): void {
  for (const seat of SEATS) {
    record.seq[seat] = 1
    sendToSeat(ctx, seat, {
      type: 'match:started',
      seat,
      seq: 1,
      events: visibleTo(events, seat),
      view: viewFor(state, seat),
    })
  }
}

/**
 * 一条指令执行完的那批事件，按座位分别下发。序号写回 `record`，**存盘是调用方的事**。
 *
 * `view` 摘掉了目录（`stripCatalog`）：目录一局只发一次，一份视图九成体积是它。
 */
export function dispatchEvents(
  ctx: DurableObjectState,
  record: RoomRecord,
  state: GameState,
  events: readonly GameEvent[],
): void {
  for (const seat of SEATS) {
    const visible = visibleTo(events, seat)
    if (visible.length === 0) continue
    record.seq[seat] += 1
    sendToSeat(ctx, seat, {
      type: 'match:events',
      seq: record.seq[seat],
      events: visible,
      view: stripCatalog(viewFor(state, seat)),
    })
  }
}

/**
 * 回一份快照。`room:resync` 和重连都走它。
 *
 * **不补发漏掉的事件**（协议 README 第 5 条）：漏掉的演出不再演，
 * 补一段迟到的动画只会让画面和局面对不上。快照带完整目录，
 * 因为重连的客户端可能是新开的页面，手上一份目录都没有。
 *
 * 只发给指定那一条连接，不发给整个座位：要快照的是这条连接，
 * 同座位另一条（正在被顶掉的旧连接）不需要。
 */
export function sendSnapshot(
  ws: WebSocket,
  record: RoomRecord,
  state: GameState,
  seat: PlayerId,
): void {
  send(ws, { type: 'match:snapshot', seq: record.seq[seat], view: viewFor(state, seat) })
}
