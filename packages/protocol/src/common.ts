/**
 * 几个消息文件（command / handshake / lobby / room）共用的小 schema 和长度上限。
 *
 * 单独一个文件而不是塞进其中某一个：座位号、卡牌 id、房间码这几样四处都在用，
 * 挑一个文件放进去，另外三个就得反过来 import 它，谁是谁的下游全乱了。
 *
 * ## 长度上限为什么处处都有
 *
 * 网络上进来的字符串没有上限就是一个洞：一条带着 10 MB 字符串的消息足以把房间对象
 * 的内存和 SQLite 撑爆，而它在类型上完全合法（`InstanceId` 就是 `string`）。
 * 所以每个字符串字段都配一个 `.max()`，数组也一样。
 * 这里的数只求「明显够用又明显不离谱」，不是规则上的精确上限——
 * 真正的规则校验是 `core` 的 `execute` 干的事（比如这张牌在不在手里）。
 */

import type { CardId, HeroId, InstanceId, PlayerId } from '@ai-duel/core'
import { z } from 'zod'

/**
 * 座位号。只有 0 和 1，负数、2、`'0'` 一律被拒。
 *
 * 写成两个 literal 的 union 而不是 `z.number().min(0).max(1)`：后者会放过 0.5，
 * 而且推出来的类型是 `number`，钉不到 core 的 `PlayerId` 上。
 */
export const playerIdSchema = z.union([z.literal(0), z.literal(1)]) satisfies z.ZodType<PlayerId>

/** id 类字符串的长度上限。引擎造的实例 id 形如 `p0-c17`，64 个字符绰绰有余。 */
export const ID_MAX_LENGTH = 64

/** 卡牌定义 id，比如 `gpt-4`。 */
export const cardIdSchema = z.string().min(1).max(ID_MAX_LENGTH) satisfies z.ZodType<CardId>

/** 卡牌实例 id，由服务端的引擎生成（`p0-c17` 这种）。 */
export const instanceIdSchema = z.string().min(1).max(ID_MAX_LENGTH) satisfies z.ZodType<InstanceId>

/**
 * 七位英雄的 id。
 *
 * 名单在 core 的 `HeroId`、content 的 `heroIdSchema` 和这里各有一份。
 * 这里不能复用 content 那份——protocol 只许依赖 core（《正式版架构》7.2 第 1 条），
 * 而校验联机消息又不能等到把整包内容数据拉进服务端才做。
 * 三份对不上时下面那句 `satisfies` 会当场编译报错，加人要一起加。
 */
export const heroIdSchema = z.enum([
  'fei-fei-li',
  'danqi-chen',
  'melanie-perkins',
  'mira-murati',
  'ada-lovelace',
  'margaret-hamilton',
  'grace-hopper',
]) satisfies z.ZodType<HeroId>

/** 给人看的提示文字的长度上限。错误消息是一句中文，200 字放得下。 */
export const TEXT_MAX_LENGTH = 200

/**
 * 一句给玩家看的中文提示，跟在 `reason` 后面。
 *
 * `reason` 是给代码 switch 的枚举，这一条是给人读的：界面直接显示它，
 * 不必为每个 reason 各写一遍文案。允许为空串（服务端偷懒不写也别让整条消息作废）。
 */
export const noticeSchema = z.string().max(TEXT_MAX_LENGTH)

/**
 * 四位数字房间码，和旧转发器一样（见 packages/server 的 `newRoomCode`）。
 *
 * 它同时是房间 Durable Object 的名字，所以形状必须卡死：
 * 放任意字符串进去等于让任何人凭一个字符串开一个新的 DO。
 */
export const roomCodeSchema = z.string().regex(/^\d{4}$/, '房间码是四位数字')

/** 四位数字房间码。 */
export type RoomCode = z.infer<typeof roomCodeSchema>

/**
 * 事件批的序号。从 1 开始，按座位各算一串（完整规则见 room.ts 的 `matchEventsSchema`）。
 *
 * 上限用 `Number.MAX_SAFE_INTEGER` 是白给的：一局最多几百批，这里只是不让
 * `Infinity` 和 `1e400` 这种数混进来当序号。
 */
export const seqSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
