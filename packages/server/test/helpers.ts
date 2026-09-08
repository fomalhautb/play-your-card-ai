/**
 * 房间测试共用的那点脚手架：签一张 JWT、连一条 WebSocket、按顺序取消息。
 *
 * 测试全部走**真的连接**（`SELF.fetch` 拿 101 再 `accept()`），不直接调内部函数：
 * 这一层要验的正是握手、座位、下发这些只有过一遍电线才成立的东西。
 * 唯一的例外是建房和答题，那两件事本来就没有客户端消息（见 MatchRoom 的两个 RPC）。
 */

import { env, runInDurableObject, SELF } from 'cloudflare:test'
import type { GameState } from '@ai-duel/core'
import type { ClientMessage, ServerMessage } from '@ai-duel/protocol'
import { parseServerMessage, subprotocolsFor } from '@ai-duel/protocol'
import { SignJWT } from 'jose'

/** 和 vitest.config.ts 里那份绑定必须一模一样，不然签出来的 token 验不过。 */
const JWT_SECRET = new TextEncoder().encode('test-jwt-secret')

/** 等一条消息的上限。workerd 里一切都在本机内存里，毫秒级就该到，给足余量。 */
const TIMEOUT_MS = 5000

/** 签一张能用的 token。`expiresIn` 传 `'-1s'` 就是一张已经过期的（作弊测试用）。 */
export async function signToken(userId: string, expiresIn = '5m'): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET)
}

/** 用别的密钥签一张，签名对不上——伪造 JWT 那条作弊测试用。 */
export async function signForgedToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('another-secret-entirely'))
}

/** 建一个房间，两个座位分别是这两个账号。 */
export async function setupRoom(code: string, players: [string, string]): Promise<void> {
  await env.MATCH_ROOM.getByName(code).setup({ players })
}

/**
 * 直接从房间的 SQLite 里把权威局面读出来。
 *
 * 「这条指令被拒之后局面一个字都没变」只能这么验：客户端拿到的是裁剪视图，
 * 隐藏的那部分（牌堆顺序、对手手牌、题目答案）恰恰是作弊最想动的地方。
 */
export async function authoritativeState(code: string): Promise<GameState> {
  return runInDurableObject(env.MATCH_ROOM.getByName(code), (_instance, state) => {
    const rows = state.storage.sql
      .exec<{ value: string }>("SELECT value FROM kv WHERE key = 'game'")
      .toArray()
    const value = rows[0]?.value
    if (value === undefined) throw new Error('房间里还没有对局')
    return JSON.parse(value) as GameState
  })
}

/** 让房间替场上的 AI 答完这一轮（迁移第 23 条改成 alarm 自己触发）。 */
export async function autoAnswer(code: string): Promise<void> {
  await env.MATCH_ROOM.getByName(code).submitAnswers()
}

/** 连接关掉时的关闭码和原因。 */
export interface Closed {
  code: number
  reason: string
}

/**
 * 一条连上去的连接，带一个消息队列。
 *
 * 队列是必须的，不能临时挂 `onmessage`：服务端可能在我们开始等之前就把消息发过来了
 *（比如握手回执），漏掉一条测试就会假失败。这一点和旧的 smoke 脚本一样。
 */
export class Client {
  private readonly inbox: ServerMessage[] = []
  private readonly waiters: ((value: ServerMessage) => void)[] = []
  private closed: Closed | null = null
  private readonly closeWaiters: ((value: Closed) => void)[] = []

  private constructor(
    private readonly ws: WebSocket,
    /** 升级响应本身，测试要拿它看回显的子协议。 */
    readonly response: Response,
  ) {
    ws.addEventListener('message', (event) => {
      const parsed = parseServerMessage(event.data)
      if (!parsed.ok) throw new Error(`服务端发了一条解析不了的消息：${parsed.error}`)
      const waiter = this.waiters.shift()
      if (waiter) waiter(parsed.value)
      else this.inbox.push(parsed.value)
    })
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason }
      for (const waiter of this.closeWaiters.splice(0)) waiter(this.closed)
    })
  }

  /** 带一张 token 连上去，子协议照 `subprotocolsFor` 拼。 */
  static connect(code: string, token: string): Promise<Client> {
    return Client.connectRaw(code, subprotocolsFor(token).join(', '))
  }

  /**
   * 自己指定 `Sec-WebSocket-Protocol` 的值，传 null 就是整个头都不带。
   *
   * 作弊测试要摆出「只提 ai-duel 不带 jwt.」和「什么都不提」这两种，
   * 它们和「带了一张坏 token」是三条不同的路。
   */
  static async connectRaw(code: string, protocols: string | null): Promise<Client> {
    const headers: Record<string, string> = { Upgrade: 'websocket' }
    if (protocols !== null) headers['Sec-WebSocket-Protocol'] = protocols
    const response = await SELF.fetch(`https://duel.test/match/${code}`, { headers })
    const ws = response.webSocket
    if (!ws) throw new Error(`没拿到 WebSocket，状态码是 ${response.status}`)
    ws.accept()
    return new Client(ws, response)
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message))
  }

  /** 发一段服务端解析不了的东西，测 `malformed` 那条路。 */
  sendRaw(text: string): void {
    this.ws.send(text)
  }

  /** 取下一条消息。超时就抛错，比让测试挂到超时容易看懂。 */
  next(): Promise<ServerMessage> {
    const buffered = this.inbox.shift()
    if (buffered) return Promise.resolve(buffered)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等消息超时（${TIMEOUT_MS}ms）`)), TIMEOUT_MS)
      this.waiters.push((value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
  }

  /** 取下一条并断言它是哪一种，省得每处都写一遍收窄。 */
  async expect<T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const message = await this.next()
    if (message.type !== type) {
      throw new Error(`等的是 ${type}，收到的是 ${message.type}`)
    }
    return message as Extract<ServerMessage, { type: T }>
  }

  /**
   * 一直取到这一种消息为止，路上别的原样丢掉。
   *
   * 只用在「路上会夹几条 `room:peer` 而它们的条数不是这条测试要验的东西」的地方
   *（比如开局前双方装载就绪那一串）。要验条数和顺序时用 `expect`，别用它。
   */
  async until<T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const message = await this.next()
      if (message.type === type) return message as Extract<ServerMessage, { type: T }>
    }
    throw new Error(`连着 32 条都不是 ${type}`)
  }

  /** 等这条连接被关掉。 */
  waitClosed(): Promise<Closed> {
    if (this.closed !== null) return Promise.resolve(this.closed)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等关闭超时（${TIMEOUT_MS}ms）`)), TIMEOUT_MS)
      this.closeWaiters.push((value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
  }

  /**
   * 此刻队列里还剩几条没取。
   *
   * 用它断言「不该再发的东西真的没发」。注意它只看**已经收到**的，
   * 所以调用前要先做一件能确定顺序的事（比如等到自己那条回执），不然只是在赌时序。
   */
  pending(): number {
    return this.inbox.length
  }

  close(): void {
    this.ws.close(1000, '测试结束')
  }
}
