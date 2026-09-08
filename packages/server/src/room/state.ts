import type { CardId, GameState, HeroId, PlayerId } from '@ai-duel/core'
import type { RoomClosedReason } from '@ai-duel/protocol'

/**
 * 房间对象自带的 SQLite 存的是什么、怎么读写。
 *
 * 存两样东西，各一行 JSON：房间这一层的成员关系（谁坐哪、装载了没、发到第几号），
 * 以及对局本身那份权威 `GameState`。
 *
 * ## 为什么不设计成一堆列和表
 *
 * 这两样都是**整体读、整体写**的：收到一条指令要先把整份 `GameState` 读出来交给
 * `execute`，算完再整份存回去，没有任何一步是「只更新某个字段」。
 * 拆成列除了写一堆映射代码没有别的好处，而且 `GameState` 里嵌着牌堆、手牌、场上单位
 * 这些数组，摊平到关系表要多一整层。
 *
 * ## 为什么每条消息都现读，不在内存里缓存
 *
 * Durable Object 会休眠（见 MatchRoom.ts 的 `acceptWebSocket`），醒来时内存里的东西全没了，
 * 缓存就得再配一套「醒来先补读」的逻辑。而 `ctx.storage.sql` 是同步接口、读的是本地磁盘，
 * 一次读没有网络往返。多一份缓存就多一处会和磁盘不一致，不划算。
 *
 * ## 目录跟着状态一起存
 *
 * `GameState.catalog` 是开局那一刻冻住的整份卡表（几十 KB），存回去时也跟着写一遍。
 * 明知费带宽也照存，是因为「这一局按开局那天的数值算完」正是把目录塞进状态的目的
 * （见 core 的 `Catalog` 和 protocol 的 view.ts）：
 * 存的时候摘掉、读的时候拿 `createCatalog()` 接回去的话，中途发一次版就会改数值。
 */

/** 一个座位报上来的牌组和英雄。`hero` 为 null 表示这一方不带英雄。 */
export interface SeatLoadout {
  deck: CardId[]
  hero: HeroId | null
}

/** 房间成员这一层的全部状态。按座位号索引，`[0]` 是 0 号座位。 */
export interface RoomRecord {
  /** 两个座位分别是哪个账号。房间建好那一刻就定死，中途不换人。 */
  players: [string, string]
  loadout: [SeatLoadout | null, SeatLoadout | null]
  ready: [boolean, boolean]
  /**
   * 每个座位各自发到第几号了。**按座位各算一串**，不是房间共用一串
   * （协议 README「序号和重同步」第 1 条）：一批事件被 `filterEvent` 对某一方过滤成空时
   * 那一方整条不发，两串号本来就会走岔。
   */
  seq: [number, number]
  /** 房间已经收了就记下原因，之后一律不让人再进（`null` 表示还开着）。 */
  closed: RoomClosedReason | null
}

/** 只有这两行，键写死。 */
const ROOM_KEY = 'room'
const GAME_KEY = 'game'

/** 房间对象的 SQLite 读写。一个房间对象一份。 */
export class RoomStore {
  constructor(private readonly sql: SqlStorage) {
    // 建表放在构造函数里而不是 blockConcurrencyWhile：`exec` 是同步的，
    // 而且 `IF NOT EXISTS` 重复跑没有副作用，对象每次醒来跑一遍也不要紧。
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  }

  /** 房间还没建（没人调过 `setup`）时返回 null。 */
  room(): RoomRecord | null {
    return this.read<RoomRecord>(ROOM_KEY)
  }

  saveRoom(record: RoomRecord): void {
    this.write(ROOM_KEY, record)
  }

  /** 对局还没开始（有人没就绪）时返回 null。 */
  game(): GameState | null {
    return this.read<GameState>(GAME_KEY)
  }

  saveGame(state: GameState): void {
    this.write(GAME_KEY, state)
  }

  private read<T>(key: string): T | null {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)
      .toArray()
    const value = row[0]?.value
    return value === undefined ? null : (JSON.parse(value) as T)
  }

  private write(key: string, value: unknown): void {
    this.sql.exec(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    )
  }
}

/**
 * 这个账号在这个房间里坐哪个座位，不是房里的人返回 null。
 *
 * 座位号就是他在 `players` 里的下标——房间只有两个人，所以 0/1 天然就是 core 的 `PlayerId`。
 * 「你是几号座」全靠这一个函数，别在别处另算一遍。
 */
export function seatOf(record: RoomRecord, userId: string): PlayerId | null {
  if (record.players[0] === userId) return 0
  if (record.players[1] === userId) return 1
  return null
}
