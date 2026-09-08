/**
 * 连接这一层：JWT 怎么塞进子协议头又怎么取出来、版本怎么比、心跳和关闭码那几个常量。
 *
 * 认证方式的取舍写在 src/handshake.ts 的文件头。这里只守行为：
 * 两端各自照常量拼、照常量拆，中间不能对不上。
 */

import { describe, expect, it } from 'vitest'
import {
  AUTH_SUBPROTOCOL_PREFIX,
  authTokenFrom,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_ROOM_FULL,
  CLOSE_ROOM_NOT_FOUND,
  CLOSE_SUPERSEDED,
  CLOSE_UNAUTHORIZED,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  isProtocolVersionSupported,
  PROTOCOL_VERSION,
  parseClientMessage,
  subprotocolsFor,
  WIRE_SUBPROTOCOL,
} from '../src/index'

/** 一个形状真实的 JWT（三段 base64url，内容是编的）。 */
const TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1XzlmM2MiLCJleHAiOjE3NjAwMDAwMDB9.-_9AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'

describe('JWT 走子协议头', () => {
  it('客户端提两个子协议：约定的那个，和带 token 的那个', () => {
    expect(subprotocolsFor(TOKEN)).toEqual([WIRE_SUBPROTOCOL, `${AUTH_SUBPROTOCOL_PREFIX}${TOKEN}`])
  })

  it('拼出去再拆回来还是同一个 token', () => {
    expect(authTokenFrom(subprotocolsFor(TOKEN).join(', '))).toBe(TOKEN)
  })

  it('JWT 的字符全在 RFC 7230 的 token 字符集里，不用再编一层码', () => {
    // 子协议名只能用这些字符，JWT 的紧凑序列化（base64url + 点）正好都在里面。
    expect(subprotocolsFor(TOKEN).every((name) => /^[!#$%&'*+\-.^_`|~\w]+$/.test(name))).toBe(true)
  })

  it('顺序反过来、中间有空格都认得出', () => {
    expect(authTokenFrom(`${AUTH_SUBPROTOCOL_PREFIX}${TOKEN} ,  ${WIRE_SUBPROTOCOL}`)).toBe(TOKEN)
  })

  it('没带 token 的各种情况一律返回 null', () => {
    expect(authTokenFrom(null)).toBe(null)
    expect(authTokenFrom(undefined)).toBe(null)
    expect(authTokenFrom('')).toBe(null)
    expect(authTokenFrom(WIRE_SUBPROTOCOL)).toBe(null)
    // 只有前缀、后面是空的，等于没带。
    expect(authTokenFrom(AUTH_SUBPROTOCOL_PREFIX)).toBe(null)
    // 前缀不对：`jwt-` 不是 `jwt.`。
    expect(authTokenFrom(`jwt-${TOKEN}`)).toBe(null)
  })
})

describe('协议版本', () => {
  it('只认自己这一版', () => {
    expect(isProtocolVersionSupported(PROTOCOL_VERSION)).toBe(true)
    expect(isProtocolVersionSupported(PROTOCOL_VERSION + 1)).toBe(false)
    expect(isProtocolVersionSupported(PROTOCOL_VERSION - 1)).toBe(false)
  })

  it('子协议名里不带版本号——版本不对要让服务端有机会把话说清楚', () => {
    expect(WIRE_SUBPROTOCOL).not.toMatch(/\d/)
  })
})

describe('心跳', () => {
  it('是两个裸字符串，不是 JSON', () => {
    expect(HEARTBEAT_PING).toBe('ping')
    expect(HEARTBEAT_PONG).toBe('pong')
  })

  it('解析器不认它们，这是对的：它们由 DO 的自动应答处理，走不到解析这一步', () => {
    expect(parseClientMessage(HEARTBEAT_PING).ok).toBe(false)
  })
})

describe('关闭码', () => {
  it('全在 WebSocket 留给应用的 4000–4999 区间里，而且互不重复', () => {
    const codes = [
      CLOSE_UNAUTHORIZED,
      CLOSE_PROTOCOL_VERSION,
      CLOSE_ROOM_NOT_FOUND,
      CLOSE_ROOM_FULL,
      CLOSE_SUPERSEDED,
    ]
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000)
      expect(code).toBeLessThanOrEqual(4999)
    }
    expect(new Set(codes).size).toBe(codes.length)
  })
})
