/**
 * 客户端和服务端之间来回传的消息类型：握手、大厅、房间、对局。
 *
 * 只有类型和编解码，没有任何规则逻辑——服务器权威，规则只在 `core` 里跑（需求第 6 条）。
 * 允许依赖：`zod` 和 `core`（指令、事件、视图的载荷直接复用 core 的类型）。
 *
 * 消息清单、时序图、序号规则、认证方式都写在 README.md 里，
 * 每条消息自己的「为什么」在 handshake.ts / lobby.ts / room.ts / command.ts 的注释里。
 *
 * ## 电线上的格式
 *
 * 每条消息是一个 JSON 文本帧，顶层有一个 `type` 字符串（风格沿用旧协议的 `域:动作`）。
 * 唯一的例外是心跳：`'ping'` / `'pong'` 是两个裸字符串，不是 JSON，理由见 handshake.ts。
 *
 * ## 严松不对称
 *
 * 客户端发上来的消息用 `z.strictObject`（多一个字段整条拒），服务端发下去的用 `z.object`
 * （多出来的字段悄悄丢掉）。方向不同，防的东西也不同：
 * 上行是不可信输入，多出来的字段本身就是可疑信号；
 * 下行来自自家服务端，宽一点是为了让服务端能先上线带新字段的版本，
 * 老客户端不至于当场炸。
 *
 * `match:events` 里那份视图按同一口径处理：它发的是不带卡池的 `ViewDelta`，
 * 真收到一份带 `catalog` 的也不整条拒，只把目录丢掉（见 view.ts）。
 */

import { z } from 'zod'
import { helloSchema, sessionRejectedSchema, welcomeSchema } from './handshake'
import { lobbyClientMessageSchemas, lobbyServerMessageSchemas } from './lobby'
import { roomClientMessageSchemas, roomServerMessageSchemas } from './room'

export * from './command'
export * from './common'
export * from './handshake'
export * from './lobby'
export * from './room'
export * from './version'
export * from './view'

/** 客户端能发的全部消息。 */
export const clientMessageSchema = z.discriminatedUnion('type', [
  helloSchema,
  ...lobbyClientMessageSchemas,
  ...roomClientMessageSchemas,
])

/** 服务端能发的全部消息。 */
export const serverMessageSchema = z.discriminatedUnion('type', [
  welcomeSchema,
  sessionRejectedSchema,
  ...lobbyServerMessageSchemas,
  ...roomServerMessageSchemas,
])

/** 客户端发给服务端的一条消息。 */
export type ClientMessage = z.infer<typeof clientMessageSchema>

/** 服务端发给客户端的一条消息。 */
export type ServerMessage = z.infer<typeof serverMessageSchema>

/**
 * 解析结果。
 *
 * 用返回值而不是抛异常：网络上进来的东西本来就可能是任何形状，解析失败是**正常路径**，
 * 不是异常。抛出去的话每个调用点都得包一层 try/catch，漏包一处就是一条连接被一段乱码搞崩。
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * 解析一条客户端消息。服务端在房间和大厅对象里收消息时用它。
 *
 * 可以直接把 WebSocket 事件里的东西丢进来：字符串会先 `JSON.parse`（parse 失败也走
 * `{ ok: false }`，不抛），已经是对象就直接校验。二进制帧不接——协议里没有二进制消息，
 * 传进来的 `ArrayBuffer` 会因为过不了 schema 而被拒。
 *
 * 心跳那两个裸字符串（`'ping'` / `'pong'`）在这里会被拒，这是**对的**：
 * 它们由 Durable Object 的自动应答处理，根本走不到这一步（见 handshake.ts）。
 */
export function parseClientMessage(input: unknown): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, input)
}

/** 解析一条服务端消息。客户端的 driver 收消息时用它。 */
export function parseServerMessage(input: unknown): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, input)
}

function parseWith<T extends z.ZodType>(schema: T, input: unknown): ParseResult<z.infer<T>> {
  let payload = input
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input)
    } catch {
      return { ok: false, error: '不是合法的 JSON' }
    }
  }
  const result = schema.safeParse(payload)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}
