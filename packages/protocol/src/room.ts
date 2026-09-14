/**
 * 房间和对局消息：装载牌组、就绪、指令上行，事件批、快照、回执下行。
 *
 * 对应《正式版架构》5.2——规则只在房间 Durable Object 里跑，客户端只发指令、只收事件，
 * 不持有完整局面。旧版那套「房主客户端跑规则、双方共享完整 `GameState`」在这里彻底反过来了：
 * 电线上再也没有 `GameState`，只有各自那一份 `PlayerView`。
 *
 * 消息分两个前缀：`room:` 是房间成员这一层（谁在、装载了没、走了没），
 * `match:` 是对局本身（开局、指令、事件、快照）。分开是因为前者在开局前后都要用，
 * 后者只有开局之后才有意义。
 *
 * ## 序号和重同步
 *
 * 1. 序号 `seq` 从 1 开始，**按座位各算一串**，不是房间共用一串。
 *    这样一批事件被 `filterEvent` 对某一方过滤成空时就整条不发，不用为了对齐编号发空包。
 * 2. 只有 `match:started` 和 `match:events` 带序号，且每发一条就 +1。
 *    `match:rejected`（指令回执）不占号：它不是「局面上发生的事」，丢了也不影响局面。
 * 3. 客户端记住收到的最后一个号。下一条的 `seq` 不等于「上一个 + 1」就是漏包了，
 *    发 `room:resync` 要一份快照。TCP 本身不会乱序也不会丢，所以漏包实际上只有一个来源：
 *    断线期间服务端发出去的那些消息。
 * 4. 重连也是发 `room:resync`：连上、收到带座位的 `session:welcome` 之后就发。
 * 5. 服务端一律回 `match:snapshot`（完整裁剪视图 + 当前序号），**不补发漏掉的事件**。
 *    漏掉的演出不再演——对局已经往前走了，补一段迟到的动画只会让画面和局面对不上。
 *
 * ## 每一批事件都带一份视图，但只带一次目录
 *
 * `match:events` 里 `events` 是拿来播动画的，`view` 是这批事件之后的**唯一真相**。
 * 之所以每批都带，是因为需求第 6 条不许客户端跑规则：客户端要是靠事件自己推算局面，
 * 就等于在客户端重写了一遍引擎。客户端的规矩因此很简单——照 `events` 演完，然后整份换成 `view`。
 *
 * 每批都带的只是局面，**不含卡池**：`PlayerView.catalog` 是那份视图的九成体积（现在约 9.6 KB，
 * 局面本身只有 0.9 KB），一局几十批就是同一份东西发几十遍。
 * 所以 `match:events` 里那份是 `ViewDelta`（不带 `catalog`），
 * 完整目录只在 `match:started` 和 `match:snapshot` 里发。拆装两个函数和理由都在 view.ts。
 */

import type { GameEvent } from '@ai-duel/core'
import { z } from 'zod'
import { playerCommandSchema } from './command'
import { cardIdSchema, heroIdSchema, noticeSchema, playerIdSchema, seqSchema } from './common'
import { playerViewSchema, viewDeltaSchema } from './view'

/**
 * 一条事件。**故意只做形状粗筛，不逐字段校验。**
 *
 * 它是服务端算出来的（`execute` 产出、再过一遍 `filterEvent`），只往客户端一个方向走。
 * 客户端不需要防着自己的服务端：这里真正的信任边界是反方向的那条——指令，
 * 那条在 command.ts 里手写了完整 schema。给事件也抄一份三十来种分支的 schema，
 * 换来的只是 core 每加一种事件就要在这里再改一遍。
 *
 * 粗筛还是要的：拿不到 `type` 的东西根本不是事件，早点拒掉好过让它渗进演出层。
 */
export const gameEventSchema = z.custom<GameEvent>(
  (value) => typeof (value as { type?: unknown } | null)?.type === 'string',
  { message: '不是一条事件' },
)

/**
 * 一批事件最多几条。一条指令能连锁出的事件有限（出一张牌 + 一串结算），
 * 开局那批最长，也就几十条。上限只是不让离谱的数组过去。
 */
const EVENTS_PER_BATCH_MAX = 256

/**
 * 牌组张数的上限。真正的规矩是 20 张（content 的 `DECK_SIZE`），同名卡最多 3 份，
 * 而且得在玩家的收藏里——那些要查内容表才知道，是**服务端**的活
 * （protocol 只许依赖 core，见《正式版架构》7.2 第 1 条，够不着 content）。
 * 这里只挡「一条消息塞十万张牌」。
 */
const DECK_CARDS_MAX = 60

/**
 * 装载：本方的牌组和英雄。双方都装载完、都就绪了，房间才开局。
 *
 * `deck` 是卡牌定义 id 的列表（可重复），洗牌交给服务端的引擎——
 * 让客户端报顺序等于让它决定自己下一张摸什么。
 * `hero` 允许是 null，表示这一方不带英雄（core 的 `PlayerSetup` 就是这么定的）。
 * 名字不在这里：显示名从 JWT 里的账号来，客户端说了不算。
 */
export const roomLoadoutSchema = z.strictObject({
  type: z.literal('room:loadout'),
  deck: z.array(cardIdSchema).min(1).max(DECK_CARDS_MAX),
  hero: heroIdSchema.nullable(),
})

/** 就绪。装载之后再点一下，防止玩家还在改牌组就被拖进对局。 */
export const roomReadySchema = z.strictObject({ type: z.literal('room:ready') })

/**
 * 主动离开房间。和掉线不一样：掉线只是暂时的（对方会看到 `room:peer` 的 online 变 false，
 * 等着重连），这条是「我不打了」，服务端据此给对方发 `room:closed`。
 */
export const roomLeaveSchema = z.strictObject({ type: z.literal('room:leave') })

/**
 * 要一份快照。重连之后发，或者发现漏包时发。
 *
 * `haveSeq` 是客户端手上的最后一个号，`0` 表示一条都没收到过。
 * 服务端不拿它做分支——一律回完整快照（见文件头第 5 条），
 * 它是给服务端记日志用的：漏了多少包、重连丢了多长一段，只有客户端知道。
 */
export const roomResyncSchema = z.strictObject({
  type: z.literal('room:resync'),
  haveSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

/**
 * 一条玩家指令。
 *
 * 载荷只认 `playerCommandSchema` 那四种：`SUBMIT_ANSWERS` 和 `DEBUG_*` 不许从网上进来，
 * 理由见 command.ts 的文件头。指令里的 `player` 字段是不是发送方自己的座位，
 * 由服务端拿连接身份核对（《正式版架构》5.2、6.7 的作弊测试）。
 */
export const matchCommandSchema = z.strictObject({
  type: z.literal('match:command'),
  command: playerCommandSchema,
})

/**
 * 对手此刻是什么状态。三件事一起报，是因为它们各自会变而客户端要的是当前全貌，
 * 每次发一份完整的就不用管消息顺序，也不会漏掉某一次变化。
 *
 * `seat` 是对手的座位号。冗余（自己的座位在 `session:welcome` 里，另一个必然是对手），
 * 写出来是为了让日志和抓包一眼能读。
 */
export const roomPeerSchema = z.object({
  type: z.literal('room:peer'),
  seat: playerIdSchema,
  /** 对手此刻有没有连着。false 不代表他走了——可能正在重连。 */
  online: z.boolean(),
  /** 对手发过 `room:loadout` 了没有。 */
  loaded: z.boolean(),
  /** 对手发过 `room:ready` 了没有。 */
  ready: z.boolean(),
})

/**
 * 房间结束了，别再重连。
 *
 * - `'match-over'`：正常打完（`GAME_OVER` 事件之后）。
 * - `'peer-left'`：对手主动发了 `room:leave`。
 * - `'idle-timeout'`：房间空了太久，服务端自己收了。
 */
export const roomClosedReasonSchema = z.enum(['match-over', 'peer-left', 'idle-timeout'])

/** 房间为什么结束了。 */
export type RoomClosedReason = z.infer<typeof roomClosedReasonSchema>

/** 房间结束了。发完这条服务端就关连接。 */
export const roomClosedSchema = z.object({
  type: z.literal('room:closed'),
  reason: roomClosedReasonSchema,
  notice: noticeSchema,
})

/**
 * 房间这一层能出的错。连接不关，只是这一条没被接受。
 *
 * - `'not-your-seat'`：指令里的 `player` 不是你的座位。作弊测试盯的就是这一条。
 * - `'not-in-match'`：对局还没开始（或已经结束）就发指令。
 * - `'already-loaded'` / `'already-ready'`：重复装载或重复就绪。
 * - `'bad-loadout'`：牌组或英雄过不了内容表那一关（张数、同名上限、不在收藏里）。
 * - `'malformed'`：整条消息连 schema 都没过。这一条**只在开发模式下发**——
 *   线上告诉对方「你发的东西我没看懂」除了帮他调试没有别的用处。
 */
export const roomErrorReasonSchema = z.enum([
  'not-your-seat',
  'not-in-match',
  'already-loaded',
  'already-ready',
  'bad-loadout',
  'malformed',
])

/** 房间这一层能出的错。 */
export type RoomErrorReason = z.infer<typeof roomErrorReasonSchema>

/** 房间报错。 */
export const roomErrorSchema = z.object({
  type: z.literal('room:error'),
  reason: roomErrorReasonSchema,
  notice: noticeSchema,
})

/**
 * 开局。带上本方座位、开局那批事件（洗牌、发牌、抛硬币）和开完之后的裁剪视图。
 *
 * 事件和视图一起发而不是分两条：分开的话客户端会先拿到一份「牌已经在手上」的视图，
 * 紧接着才收到「你摸了这几张」的事件，摸牌动画就没地方演了。
 *
 * `seq` 正常是 1，仍然写出来，好让客户端「记住最后一个号」这件事只有一条规则。
 *
 * `view` 是**完整的** `PlayerView`，带着整份卡池。客户端把这份 `catalog` 存下来，
 * 后面每批 `match:events` 都靠它把视图补全（见 view.ts）。
 */
export const matchStartedSchema = z.object({
  type: z.literal('match:started'),
  seat: playerIdSchema,
  seq: seqSchema,
  events: z.array(gameEventSchema).max(EVENTS_PER_BATCH_MAX),
  view: playerViewSchema,
})

/**
 * 一条指令执行完产生的事件，加上执行完之后的视图。
 *
 * `events` 是**已经过 `filterEvent`** 的那一份（对手的手牌、题目答案在这里就已经没了），
 * `view` 是 `viewFor` 的产物再摘掉卡池（`stripCatalog`）。两者都只属于收件的这一方。
 *
 * 这里的 `view` 是 `ViewDelta` 不是 `PlayerView`：目录一局只发一次，客户端收到之后
 * 用 `attachCatalog` 把开局那份接回去（为什么这么拆、为什么不用客户端本地的 content，见 view.ts）。
 */
export const matchEventsSchema = z.object({
  type: z.literal('match:events'),
  seq: seqSchema,
  events: z.array(gameEventSchema).max(EVENTS_PER_BATCH_MAX),
  view: viewDeltaSchema,
})

/**
 * 快照：`room:resync` 的回答，重连也走它。
 *
 * 没有 `events`——不补演出（见文件头第 5 条）。客户端拿到之后直接把界面画成 `view` 的样子，
 * 并把 `seq` 记成新的「最后一个号」。
 *
 * `view` 和 `match:started` 一样是**完整的** `PlayerView`：重连的客户端可能是新开的页面，
 * 手上一份目录都没有，快照得把它一并补上。
 */
export const matchSnapshotSchema = z.object({
  type: z.literal('match:snapshot'),
  seq: seqSchema,
  view: playerViewSchema,
})

/**
 * 指令被引擎拒了。**只发给发指令的那一方。**
 *
 * 内容就是 core 那条 `COMMAND_REJECTED` 事件的 `reason`。它之所以不混在 `match:events` 里，
 * 是因为 `filterEvent` 对 `COMMAND_REJECTED` 一律返回 null（见 core 的 view.ts）：
 * 那是对一条指令的回执，不是局面上发生的事，不进广播。服务端先把这一条挑出来单独回，
 * 其余事件再逐条过 `filterEvent` 分别下发。
 *
 * 不带序号，也不带「这是哪条指令的回执」：客户端一次只让一条指令在飞
 *（出牌是同步交互，发出去按钮就置灰等回执），所以「上一条被拒了」不会认错人。
 */
export const matchRejectedSchema = z.object({
  type: z.literal('match:rejected'),
  reason: noticeSchema,
})

/** 客户端发给房间的全部消息。 */
export const roomClientMessageSchemas = [
  roomLoadoutSchema,
  roomReadySchema,
  roomLeaveSchema,
  roomResyncSchema,
  matchCommandSchema,
] as const

/** 房间发给客户端的全部消息。 */
export const roomServerMessageSchemas = [
  roomPeerSchema,
  roomClosedSchema,
  roomErrorSchema,
  matchStartedSchema,
  matchEventsSchema,
  matchSnapshotSchema,
  matchRejectedSchema,
] as const
