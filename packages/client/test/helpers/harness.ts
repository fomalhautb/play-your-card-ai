/**
 * 测试脚手架：一个假平台，加上「服务端发一条」「客户端发了哪些」两个口子。
 *
 * 两个方向的消息都要过一遍 protocol 的解析：
 * - 发下来的过 `parseServerMessage`，手写错形状当场就报，不会带着一条非法消息去测 driver；
 * - 发上去的过 `parseClientMessage`（上行是 strictObject，多一个字段整条拒），
 *   这样「客户端发出去的东西合不合协议」不用另写一组断言。
 */

import { createFakePlatform, type FakePlatform, type FakeSocket } from '@ai-duel/platform'
import type { ClientMessage, ServerMessage } from '@ai-duel/protocol'
import {
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  parseClientMessage,
  parseServerMessage,
} from '@ai-duel/protocol'

export interface Harness {
  platform: FakePlatform
  /** 最新那条连接。重连之后 `sockets` 不变，因为假实现是在同一个 socket 上重连的。 */
  socket(): FakeSocket
  /** 假装服务端发来一条消息。 */
  deliver(message: ServerMessage): void
  /** 客户端已经发出去的消息，按顺序解析回对象。心跳那两个裸字符串不在里面。 */
  sent(): ClientMessage[]
  /** 客户端发出去的裸字符串（就是心跳）。 */
  rawSent(): string[]
}

export function createHarness(): Harness {
  const platform = createFakePlatform()

  function socket(): FakeSocket {
    const latest = platform.network.sockets.at(-1)
    if (latest === undefined) throw new Error('还没有连接被开出来')
    return latest
  }

  return {
    platform,
    socket,

    deliver(message) {
      const parsed = parseServerMessage(message)
      if (!parsed.ok) throw new Error(`测试造了一条非法的服务端消息：${parsed.error}`)
      // 发原对象序列化出来的那份，不发解析产物：`match:events` 的视图在解析时会被
      // 摘掉卡池（viewDeltaSchema 的 transform），拿它当电线上的原文就不对了。
      socket().deliver(JSON.stringify(message))
    },

    sent() {
      const messages: ClientMessage[] = []
      for (const frame of socket().sent) {
        if (frame === HEARTBEAT_PING || frame === HEARTBEAT_PONG) continue
        const parsed = parseClientMessage(frame)
        if (!parsed.ok) throw new Error(`客户端发了一条不合协议的消息：${parsed.error}`)
        messages.push(parsed.value)
      }
      return messages
    },

    rawSent: () => [...socket().sent],
  }
}
