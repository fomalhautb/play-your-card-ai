/**
 * 房间测试共用的那点脚手架：连一条 WebSocket、按顺序取消息、翻权威局面。
 *
 * 测试全部走**真的连接**（`SELF.fetch` 拿 101 再 `accept()`），不直接调内部函数：
 * 这一层要验的正是握手、座位、下发这些只有过一遍电线才成立的东西。
 * 例外只有两处，它们本来就没有客户端消息：建房走的是大厅调的那几个 RPC，
 * 答题走的是 Durable Object 的 alarm。
 *
 * 账号和 token 那一摊在 accounts.ts：测试里说的 'alice'、'bob' 是**标签**，
 * 背后是 better-auth 真开的游客账号，id 由它随机生成。
 */

import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import type { GameState } from '@ai-duel/core'
import type { ClientMessage, ServerMessage } from '@ai-duel/protocol'
import { PROTOCOL_VERSION, parseServerMessage, subprotocolsFor } from '@ai-duel/protocol'
import { accountId, TEST_ORIGIN, tokenFor } from './accounts'

/** 一条能用的 `session:hello`。大厅和房间的第一条消息是同一条。 */
export const HELLO: ClientMessage = {
  type: 'session:hello',
  protocolVersion: PROTOCOL_VERSION,
  clientVersion: '0.0.0-test',
}

/** 等一条消息的上限。workerd 里一切都在本机内存里，毫秒级就该到，给足余量。 */
const TIMEOUT_MS = 5000

/**
 * 建一个房间，两个座位分别是这两个标签对应的账号（大厅配对成功时调的就是这个 RPC）。
 *
 * 传标签而不是账号 id：账号 id 是 better-auth 随机生成的，测试写不出来。
 */
export async function setupRoom(code: string, players: [string, string]): Promise<void> {
  const seated: [string, string] = [await accountId(players[0]), await accountId(players[1])]
  await env.MATCH_ROOM.getByName(code).setup({ players: seated })
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

/**
 * 把房间的 alarm 立刻叫醒，返回有没有真的响过一次。
 *
 * 答题、空房超时都靠它推进：`runDurableObjectAlarm` 不管到没到点，排着就会跑一次，
 * 所以测试不用真等 2.5 秒（房间那边为什么这样也是对的，见 src/room/alarms.ts 的文件头）。
 * 房间收摊之后 alarm 会被撤掉，这时它返回 false。
 */
export async function fireRoomAlarm(code: string): Promise<boolean> {
  return runDurableObjectAlarm(env.MATCH_ROOM.getByName(code))
}

/**
 * 等到房间里一条连接都不剩。
 *
 * 客户端 `close()` 之后服务端那半边的关闭回调是异步的，不等一下就去验空房超时，
 * 房间可能还以为有人在线。轮询而不是固定睡一觉：workerd 里这几步是微秒级的，
 * 睡死时间只会让测试变慢。
 */
export async function waitRoomEmpty(code: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const count = await runInDurableObject(
      env.MATCH_ROOM.getByName(code),
      (_instance, state) => state.getWebSockets().length,
    )
    if (count === 0) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`房间 ${code} 里的连接一直没断干净`)
}

/**
 * 把某种定时任务的到点时刻改到过去，好让下一次 alarm 就轮到它。
 *
 * 空房超时排在十分钟后，测试等不起；直接改那一行比等真实时间可靠，
 * 而且走的仍然是生产代码那条判定路径（alarm 响 → 看谁到点 → 各自检查条件）。
 */
export async function expireAlarm(code: string, kind: 'quiz' | 'idle'): Promise<void> {
  await runInDurableObject(env.MATCH_ROOM.getByName(code), (_instance, state) => {
    const rows = state.storage.sql
      .exec<{ value: string }>("SELECT value FROM kv WHERE key = 'deadlines'")
      .toArray()
    const deadlines = JSON.parse(rows[0]?.value ?? '{}') as Record<string, number>
    deadlines[kind] = 1
    state.storage.sql.exec(
      "INSERT INTO kv (key, value) VALUES ('deadlines', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(deadlines),
    )
  })
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

  /** 带一张 token 连房间，子协议照 `subprotocolsFor` 拼。 */
  static connect(code: string, token: string): Promise<Client> {
    return Client.connectRaw(code, subprotocolsFor(token).join(', '))
  }

  /** 带一张 token 连大厅。路径里不带名字：全局只有一个大厅。 */
  static connectLobby(token: string): Promise<Client> {
    return Client.open('/lobby', subprotocolsFor(token).join(', '))
  }

  /** 连大厅、打完招呼、确认 welcome 说的是大厅，一步到位。 */
  static async openLobby(label: string): Promise<Client> {
    const client = await Client.connectLobby(await tokenFor(label))
    client.send(HELLO)
    const welcome = await client.expect('session:welcome')
    if (welcome.place.kind !== 'lobby') throw new Error(`${label} 连的不是大厅`)
    return client
  }

  /**
   * 自己指定 `Sec-WebSocket-Protocol` 的值，传 null 就是整个头都不带。
   *
   * 作弊测试要摆出「只提 ai-duel 不带 jwt.」和「什么都不提」这两种，
   * 它们和「带了一张坏 token」是三条不同的路。
   */
  static connectRaw(code: string, protocols: string | null): Promise<Client> {
    return Client.open(`/match/${code}`, protocols)
  }

  private static async open(path: string, protocols: string | null): Promise<Client> {
    const headers: Record<string, string> = { Upgrade: 'websocket' }
    if (protocols !== null) headers['Sec-WebSocket-Protocol'] = protocols
    const response = await SELF.fetch(`${TEST_ORIGIN}${path}`, { headers })
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
