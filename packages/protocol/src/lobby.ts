/**
 * 大厅消息：排队匹配、私人开房、按房间码加入。
 *
 * 对应《正式版架构》5.4——大厅是一个全局的 Durable Object，维护一条队列，
 * 配对成功就建房间并把房间码发给双方。客户端**不在大厅里打牌**：
 * 拿到房间码之后另开一条 WebSocket 连房间对象（见 room.ts）。
 * 两个对象两条连接，是因为它们本来就是两个 DO，一条连接跨不过去。
 *
 * 「按房间码加入」也走大厅而不是直接连房间：房间码就是房间 DO 的名字，
 * 直接连等于任何人打错一个数字就凭空创建一个 DO。让大厅先问一句这个码在不在，
 * 打错的码就停在大厅这一层。
 */

import { z } from 'zod'
import { noticeSchema, roomCodeSchema } from './common'

/** 加入匹配队列。队列是全局一条，没有分段和分区。 */
export const lobbyQueueSchema = z.strictObject({ type: z.literal('lobby:queue') })

/** 退出匹配队列。玩家点「取消」，或者切走了。 */
export const lobbyCancelSchema = z.strictObject({ type: z.literal('lobby:cancel') })

/** 开一个私人房，服务端摇一个没人用的房间码回来，玩家把码发给朋友。 */
export const lobbyCreateSchema = z.strictObject({ type: z.literal('lobby:create') })

/** 按房间码加入朋友开的房。码不存在或房间满了会回 `lobby:error`。 */
export const lobbyJoinSchema = z.strictObject({
  type: z.literal('lobby:join'),
  code: roomCodeSchema,
})

/** 已经排上队了。界面据此从「开始匹配」切到「匹配中…」。 */
export const lobbyQueuedSchema = z.object({ type: z.literal('lobby:queued') })

/** 已经退出队列了。`lobby:cancel` 的回执。 */
export const lobbyCanceledSchema = z.object({ type: z.literal('lobby:canceled') })

/**
 * 这个房间码是怎么来的。
 *
 * 三种来源合成一条消息而不是三条：对客户端来说要做的事都一样——拿着这个码去连房间对象。
 * 不同的只有界面上那句话（「匹配成功」/「房间已创建，把码发给朋友」/「正在进入房间」），
 * 所以差别做成一个字段，而不是三种消息各写一遍房间码的形状。
 */
export const lobbyRoomOriginSchema = z.enum(['queue', 'create', 'join'])

/** 这个房间码是怎么来的。 */
export type LobbyRoomOrigin = z.infer<typeof lobbyRoomOriginSchema>

/**
 * 拿去连房间对象的房间码。
 *
 * `origin` 是 `'create'` 时房里还只有自己，得等朋友进来；
 * 另外两种进去就该有人（或者马上就有）。座位号不在这里——那是房间对象在
 * `session:welcome` 里给的（见 handshake.ts），大厅不掺和座位分配。
 */
export const lobbyRoomSchema = z.object({
  type: z.literal('lobby:room'),
  code: roomCodeSchema,
  origin: lobbyRoomOriginSchema,
})

/**
 * 大厅这一层能出的错。
 *
 * - `'room-not-found'` / `'room-full'`：`lobby:join` 用的码不对，或者那房间已经两个人了。
 * - `'already-queued'` / `'not-queued'`：重复入队、没排队却发取消。多半是界面状态和服务端错开了，
 *   客户端收到它应该以服务端为准把按钮改回去，而不是重试。
 * - `'no-room-code'`：连摇十次房间码都撞车（旧转发器同款上限，见 packages/server 的 `createRoom`）。
 *   这一条可以重试。
 */
export const lobbyErrorReasonSchema = z.enum([
  'room-not-found',
  'room-full',
  'already-queued',
  'not-queued',
  'no-room-code',
])

/** 大厅这一层能出的错。 */
export type LobbyErrorReason = z.infer<typeof lobbyErrorReasonSchema>

/** 大厅报错。连接不关，玩家可以接着操作。 */
export const lobbyErrorSchema = z.object({
  type: z.literal('lobby:error'),
  reason: lobbyErrorReasonSchema,
  notice: noticeSchema,
})

/** 客户端发给大厅的全部消息。 */
export const lobbyClientMessageSchemas = [
  lobbyQueueSchema,
  lobbyCancelSchema,
  lobbyCreateSchema,
  lobbyJoinSchema,
] as const

/** 大厅发给客户端的全部消息。 */
export const lobbyServerMessageSchemas = [
  lobbyQueuedSchema,
  lobbyCanceledSchema,
  lobbyRoomSchema,
  lobbyErrorSchema,
] as const
