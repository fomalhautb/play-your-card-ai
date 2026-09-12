/**
 * 验 Steam 票据那一层（迁移第 35 条，src/auth/steamTicket.ts）。
 *
 * 这一组**直接调函数**，不走 `SELF.fetch`：要验的是「发给 Valve 的请求长什么样」和
 * 「Valve 各种答复分别怎么解读」，而那一次外发请求只能靠把全局 `fetch` 换掉才看得见。
 * 走整条路的那一组在 steam.test.ts。
 *
 * 答复的形状照 `ISteamUserAuth/AuthenticateUserTicket` 的真实格式写：
 * 成功和失败都是 200，靠 `response` 里有没有 `params` 区分。
 */

import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STEAM_TICKET_IDENTITY, verifySteamTicket } from '../src/auth/steamTicket'

/** 一张形状合法的票据。真票据一千多个十六进制字符，这里够长就行。 */
const TICKET = 'a1b2c3d4e5f60718'

/** 测试里用的假密钥和 appId。配上它们就会走「真的去问 Valve」那条。 */
const KEY = 'test-publisher-key'
const APP_ID = '3000123'

/** 带上密钥和 appId 的 env。`env` 本身是整个文件共用的，所以复制一份出来改。 */
function withKey(): Env {
  return { ...env, STEAM_WEB_API_KEY: KEY, STEAM_APP_ID: APP_ID }
}

/** 把全局 fetch 换成「不管问什么都回这一份」，并记下请求的地址。 */
function stubSteam(body: unknown, init: ResponseInit = {}): { urls: string[] } {
  const urls: string[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    urls.push(String(input))
    return Promise.resolve(new Response(JSON.stringify(body), init))
  })
  return { urls }
}

/** Valve 说「这张票是 steamId 的」。 */
function okResponse(steamId: string, extra: Record<string, unknown> = {}): unknown {
  return {
    response: {
      params: {
        result: 'OK',
        steamid: steamId,
        ownersteamid: steamId,
        vacbanned: false,
        publisherbanned: false,
        ...extra,
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('票据的形状', () => {
  it('空的、太短的、非十六进制的都不去问 Valve', async () => {
    const stub = stubSteam(okResponse('76561198000000001'))
    for (const bad of ['', 'a1b2', 'zzzzzzzzzzzzzzzz', `${TICKET}!`]) {
      expect(await verifySteamTicket(bad, withKey())).toBeNull()
    }
    // 关键在这一条：形状不对的票据一次外发请求都不该产生，
    // 否则谁都能拿这个端点当放大器去打 Valve（而且每一次都记在我们的额度上）。
    expect(stub.urls).toEqual([])
  })

  it('长得离谱的也挡在门口', async () => {
    const stub = stubSteam(okResponse('76561198000000001'))
    expect(await verifySteamTicket('ab'.repeat(4096), withKey())).toBeNull()
    expect(stub.urls).toEqual([])
  })
})

describe('问 Valve', () => {
  it('地址上带齐 key、appid、ticket、identity', async () => {
    const stub = stubSteam(okResponse('76561198000000001'))
    expect(await verifySteamTicket(TICKET, withKey())).toBe('76561198000000001')

    expect(stub.urls).toHaveLength(1)
    const url = new URL(stub.urls[0]!)
    expect(url.origin + url.pathname).toBe(
      'https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
    )
    expect(url.searchParams.get('key')).toBe(KEY)
    expect(url.searchParams.get('appid')).toBe(APP_ID)
    expect(url.searchParams.get('ticket')).toBe(TICKET)
    // identity 对不上整张票在 Valve 那边就作废，所以它必须和客户端取票时用的那个一样。
    expect(url.searchParams.get('identity')).toBe(STEAM_TICKET_IDENTITY)
  })

  it('没配 appId 时用 480（SpaceWar）', async () => {
    const stub = stubSteam(okResponse('76561198000000001'))
    await verifySteamTicket(TICKET, { ...env, STEAM_WEB_API_KEY: KEY })
    expect(new URL(stub.urls[0]!).searchParams.get('appid')).toBe('480')
  })

  it('Valve 说不行就是不行', async () => {
    // 票据不对时它回的也是 200，只是 response 里换成了 error。
    stubSteam({ response: { error: { errorcode: 101, errordesc: 'Invalid ticket' } } })
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()
  })

  it('result 不是 OK 也不认', async () => {
    stubSteam(okResponse('76561198000000001', { result: 'Failure' }))
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()
  })

  it('steamid 不是纯数字就不认', async () => {
    // 真 steamId 永远是一个 64 位整数的十进制写法。别的形状说明答复被人动过手脚，
    // 或者我们把别的接口的答复当成了它。
    stubSteam(okResponse('dev-000000'))
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()
  })

  it('被我们自己封过的号进不来，VAC 封禁不拦', async () => {
    stubSteam(okResponse('76561198000000002', { publisherbanned: true }))
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()

    vi.unstubAllGlobals()
    // VAC 是别的游戏里作的弊，和这里没关系，拦了只会误伤。
    stubSteam(okResponse('76561198000000002', { vacbanned: true }))
    expect(await verifySteamTicket(TICKET, withKey())).toBe('76561198000000002')
  })

  it('Valve 不通、答复看不懂，都只是「进不来」，不抛错', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('网络不通')))
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()

    vi.unstubAllGlobals()
    stubSteam(okResponse('76561198000000001'), { status: 500 })
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()

    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>维护中</html>')))
    expect(await verifySteamTicket(TICKET, withKey())).toBeNull()
  })
})

describe('没配密钥的时候', () => {
  it('开发模式收任意票据，同一张票据永远算出同一个账号', async () => {
    const stub = stubSteam(okResponse('76561198000000001'))
    const first = await verifySteamTicket(TICKET, env)
    const again = await verifySteamTicket(TICKET, env)
    const other = await verifySteamTicket('ffffffffffffffff', env)

    expect(first).not.toBeNull()
    expect(again).toBe(first)
    // 不同票据要算出不同的号，本机才开得出两个进程当两个人对打。
    expect(other).not.toBe(first)
    // `dev-` 前缀让开发期的号和真 steamId（纯数字）在 account 表里永远撞不到一起。
    expect(first).toMatch(/^dev-[0-9a-f]{32}$/)
    // 开发模式一次外发请求都不该有——本机没有 Steam 客户端，也不该去打扰 Valve。
    expect(stub.urls).toEqual([])
  })

  it('不是开发模式就一律拒绝（失败关闭）', async () => {
    // 线上漏配密钥时，宁可谁都登不进来，也不能变成「随便递一段字符串就是一个新账号」。
    expect(await verifySteamTicket(TICKET, { ...env, DEV: undefined })).toBeNull()
  })
})
