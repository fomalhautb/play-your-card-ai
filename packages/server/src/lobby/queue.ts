import type { RoomCode } from '@ai-duel/protocol'
import { customAlphabet } from 'nanoid'

/**
 * 大厅对象自带的 SQLite：一条匹配队列，一张在用的房间码表。
 *
 * ## 为什么这里是真的表，房间那边是一行 JSON
 *
 * 房间的状态整体读整体写（见 room/state.ts），拆成列没有好处。
 * 大厅相反：队列要按入队时间取最早的两个、房间码要按码查在不在，
 * 两样都是「在一堆行里挑几行」，正是 SQL 干的活。行数也不同——
 * 大厅是全局单实例，队列和码表会一直有人进进出出。
 *
 * ## 房间码只有一万个，用完了会怎样
 *
 * 表最多也就长到一万行（四位码的全集），每行几十字节，不需要定期打扫。
 * 房间收摊时会调 `release` 把自己那行删掉（见 room/lifecycle.ts），
 * 万一那次 RPC 没成功，这个码就一直占着——所以摇码时还看一眼 `createdAt`：
 * 太老的行当作已经没人了，可以直接盖掉（见 `hasLiveRoom`）。
 * 一条对局几分钟就打完，这个岁数上限设得比任何一局都长得多，不会把活着的房间挤掉。
 */

/**
 * 四位数字房间码（`roomCodeSchema` 卡的也是这个）。
 *
 * 用 nanoid 而不是自己拿 `crypto.getRandomValues` 取模：取模会让靠前的数字概率略高，
 * 而 nanoid 已经处理好了这件事。
 */
const newRoomCode = customAlphabet('0123456789', 4)

/**
 * 摇码的重试次数上限，10 次。
 *
 * 四位码只有一万种，撞号是正常情况，撞到就重摇；但不能无上限地摇——
 * Worker 里的死循环会一直烧 CPU 时间。摇满十次还撞就回 `no-room-code` 让玩家重试。
 */
const CODE_ATTEMPTS = 10

/**
 * 一行房间记录最多算活着多久。
 *
 * 这是兜底，不是正常的回收路径：正常路径是房间收摊时主动 `release`。
 * 六小时远长于任何一局对局（也长于空房超时的十分钟），
 * 所以一行活到这个岁数只可能是那次 `release` 没送到。
 */
const ROOM_MAX_LIFETIME_MS = 6 * 60 * 60_000

/** 大厅对象的 SQLite 读写。全局只有一个大厅实例，所以也只有一份。 */
export class LobbyStore {
  constructor(private readonly sql: SqlStorage) {
    // 建表放在构造函数里而不是 blockConcurrencyWhile：`exec` 是同步的，
    // 而且 `IF NOT EXISTS` 重复跑没有副作用，对象每次醒来跑一遍也不要紧。
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS queue (userId TEXT PRIMARY KEY, joinedAt INTEGER NOT NULL)',
    )
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, createdAt INTEGER NOT NULL)',
    )
  }

  isQueued(userId: string): boolean {
    return this.sql.exec('SELECT 1 FROM queue WHERE userId = ?', userId).toArray().length > 0
  }

  /** 入队。同一个人重复入队由调用方先挡（要回 `already-queued`），这里按覆盖处理。 */
  enqueue(userId: string, joinedAt: number): void {
    this.sql.exec(
      'INSERT INTO queue (userId, joinedAt) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET joinedAt = excluded.joinedAt',
      userId,
      joinedAt,
    )
  }

  /** 出队。不在队里也不报错——断线时无条件调一次，不必先查。 */
  dequeue(userId: string): void {
    this.sql.exec('DELETE FROM queue WHERE userId = ?', userId)
  }

  /**
   * 队里最早的两个人，够不上两个就返回 null。
   *
   * 只看不取：取出来之后还要摇房间码，摇不出来的话这两个人应该原地留在队里
   * 等下一次有人进来时再试，而不是被无声地踢出队列。真正的出队由 `dequeue` 做。
   */
  firstTwo(): [string, string] | null {
    // 同一毫秒入队的按 `rowid`（SQLite 的插入顺序）排，不能按 userId——
    // 那样等于按账号 id 的字典序决定谁先配上，而账号 id 是随机的。
    //
    // 同一毫秒不是罕见情况：Durable Object 里的 `Date.now()` 只在做过 I/O 之后才往前走，
    // 而处理入队全程只碰同步的 SQLite，所以背靠背进来的两个人拿到的时间戳常常一模一样。
    const rows = this.sql
      .exec<{ userId: string }>('SELECT userId FROM queue ORDER BY joinedAt, rowid LIMIT 2')
      .toArray()
    const [first, second] = rows
    if (first === undefined || second === undefined) return null
    return [first.userId, second.userId]
  }

  /** 这个码此刻是不是还归某个房间用。`lobby:join` 靠它认出打错的码。 */
  hasLiveRoom(code: string, now: number): boolean {
    const rows = this.sql
      .exec<{ createdAt: number }>('SELECT createdAt FROM rooms WHERE code = ?', code)
      .toArray()
    const createdAt = rows[0]?.createdAt
    if (createdAt === undefined) return false
    return createdAt > now - ROOM_MAX_LIFETIME_MS
  }

  /** 摇一个没人用的房间码，连着撞十次就返回 null（调用方回 `no-room-code`）。 */
  allocateCode(now: number): RoomCode | null {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = newRoomCode()
      if (!this.hasLiveRoom(code, now)) return code
    }
    return null
  }

  /** 记下这个码归一个房间了。摇到一个过了岁数的旧码时会盖掉那一行。 */
  addRoom(code: RoomCode, createdAt: number): void {
    this.sql.exec(
      'INSERT INTO rooms (code, createdAt) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET createdAt = excluded.createdAt',
      code,
      createdAt,
    )
  }

  /** 房间收摊了，码可以再发给别人。 */
  releaseRoom(code: string): void {
    this.sql.exec('DELETE FROM rooms WHERE code = ?', code)
  }
}
