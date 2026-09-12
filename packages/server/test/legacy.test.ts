/**
 * 旧转发器的护栏。**它冻结了但还在线上跑**（见 src/legacy/room.ts），
 * 所以新服务端并排加进来之后，这几条时序必须原样成立。
 *
 * 挑的是 test/smoke.mjs 里最关键、也最容易被改坏的那几条：
 * 摇房间码、同一个玩家的新连接顶掉旧的、以及「重连不能给对手误报掉线」。
 * 那三条全是**时序**问题，只有在旧连接还没被运行时回收时才暴露，
 * 浏览器里基本没法稳定复现，只能像这样把两条并存的连接直接摆出来。
 *
 * smoke 脚本本身保留：它打的是真的 `wrangler dev` 或线上，覆盖面比这里宽
 *（静态资源回退、CORS、跨房间释放）。这里只是把最要命的几条钉进 CI。
 */

import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

/** 旧转发器的关闭码，抄自 src/legacy/room.ts（那份是冻结的，不从代码里 import）。 */
const CLOSE_SUPERSEDED = 4004

/** 一条连到旧转发器的连接。载荷是裸文本，不是新协议那套 JSON。 */
class RelayPeer {
  private readonly inbox: string[] = []
  private readonly waiters: ((value: string) => void)[] = []
  private closeCode: number | null = null
  private readonly closeWaiters: ((value: number) => void)[] = []

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const text = String(event.data)
      const waiter = this.waiters.shift()
      if (waiter) waiter(text)
      else this.inbox.push(text)
    })
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code
      for (const waiter of this.closeWaiters.splice(0)) waiter(event.code)
    })
  }

  static async connect(
    code: string,
    role: 'host' | 'guest',
    peerId: string,
    resume = false,
  ): Promise<RelayPeer> {
    const query = `role=${role}&peer=${peerId}${resume ? '&resume=1' : ''}`
    const response = await SELF.fetch(`https://duel.test/room/${code}?${query}`, {
      headers: { Upgrade: 'websocket' },
    })
    const ws = response.webSocket
    if (!ws) throw new Error(`没拿到 WebSocket，状态码是 ${response.status}`)
    ws.accept()
    return new RelayPeer(ws)
  }

  send(text: string): void {
    this.ws.send(text)
  }

  next(): Promise<string> {
    const buffered = this.inbox.shift()
    if (buffered !== undefined) return Promise.resolve(buffered)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等消息超时')), 5000)
      this.waiters.push((value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
  }

  waitClosed(): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等关闭超时')), 5000)
      this.closeWaiters.push((value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
  }

  close(): void {
    this.ws.close(1000, '测试结束')
  }
}

/** 进房之后紧跟着两帧：回执和对端状态。都收掉，后面的断言才对得上。 */
async function join(
  code: string,
  role: 'host' | 'guest',
  peerId: string,
  resume = false,
): Promise<{ peer: RelayPeer; presence: string }> {
  const peer = await RelayPeer.connect(code, role, peerId, resume)
  expect(await peer.next()).toBe('#room:ok')
  return { peer, presence: await peer.next() }
}

describe('旧转发器（冻结，不许改坏）', () => {
  it('GET /api/room 给一个四位数字房间码，带 CORS 头', async () => {
    const response = await SELF.fetch('https://duel.test/api/room')
    expect(response.status).toBe(200)
    // 这个头只在本地开发（Vite 5173 → wrangler 8787 跨域）起作用，线上同域感觉不到它没了。
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const body = (await response.json()) as { code?: string }
    expect(body.code).toMatch(/^\d{4}$/)
  })

  it('同一个玩家重连：顶掉旧连接，而且不给对手误报掉线', async () => {
    const host = await join('9001', 'host', 'p-host')
    expect(host.presence).toBe('#peer:offline')
    const guest = await join('9001', 'guest', 'p-guest')
    expect(await host.peer.next()).toBe('#peer:joined')

    /*
     * 核心时序：**故意不关旧连接**，直接用同一个 peer id 再连一条。
     * 网络异常断开时运行时要过一阵才回收旧连接，这中间房里"还有一个 guest"——
     * 按连接数判房满的话，重连的人会被自己的僵尸连接挡在门外，永远回不去。
     */
    const back = await join('9001', 'guest', 'p-guest', true)
    expect(back.presence).toBe('#peer:online')
    expect(await guest.peer.waitClosed()).toBe(CLOSE_SUPERSEDED)

    // 对手看到的必须是「他回来了」，不是「新人进房」。
    expect(await host.peer.next()).toBe('#peer:online')

    /*
     * 最关键的一条：顶掉旧连接会触发关闭回调，那里要是不先确认「这个玩家一条连接都不剩了」，
     * 就会给对手补一条 #peer:offline，一局正常进行的对局会莫名其妙被判中断。
     * 这里不靠"等一会儿看有没有"，而是让重连方发一条载荷：
     * 真有那条多余的 offline，它一定排在载荷前面。
     */
    back.peer.send('after-reconnect')
    expect(await host.peer.next()).toBe('>after-reconnect')

    host.peer.close()
    back.peer.close()
  })

  it('对手真的走了才发 peer:offline', async () => {
    const host = await join('9002', 'host', 'p-host')
    const guest = await join('9002', 'guest', 'p-guest')
    expect(await host.peer.next()).toBe('#peer:joined')
    guest.peer.close()
    expect(await host.peer.next()).toBe('#peer:offline')
    host.peer.close()
  })

  it('第三个人进不来', async () => {
    const host = await join('9003', 'host', 'p-host')
    const guest = await join('9003', 'guest', 'p-guest')
    expect(await host.peer.next()).toBe('#peer:joined')

    const third = await RelayPeer.connect('9003', 'guest', 'p-third')
    // 被拒的连接也是先 101 再关，所以这里等的是关闭码不是握手失败。
    expect(await third.waitClosed()).toBe(4002)
    host.peer.close()
    guest.peer.close()
  })

  it('新房间的路径不会被旧转发器截走', async () => {
    // 两套路由并排跑，/match/* 必须落到新的房间对象上（那边没建房，所以回 room-not-found）。
    const response = await SELF.fetch('https://duel.test/match/9004', {
      headers: { Upgrade: 'websocket' },
    })
    expect(response.status).toBe(101)
    const ws = response.webSocket
    if (!ws) throw new Error('没拿到 WebSocket')
    ws.accept()
    const first = await new Promise<string>((resolve) => {
      ws.addEventListener('message', (event) => resolve(String(event.data)))
    })
    expect(JSON.parse(first)).toMatchObject({ type: 'session:rejected' })
  })
})
