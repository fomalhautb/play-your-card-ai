/**
 * 两条登录路径：游客（进站开号）和 Steam（票据换会话），以及换 JWT、错误态和重试。
 *
 * 游客那三条路各自只在特定的一次进站里走得到：头一次进站要开号，之后进站只换 token
 *（重复开号会被 better-auth 回 400），而服务端没起来时整页要有个能看懂的错，
 * 而不是一直转圈。
 *
 * Steam 那条（迁移第 35 条）全靠假平台的 `steam` 那一项：真票据要 Steam 客户端在跑，
 * 本机和 CI 都跑不了（见 platform 的 fake/steam.ts）。
 */

import { createFakePlatform } from '@ai-duel/platform'
import { describe, expect, it } from 'vitest'
import { createAuthSession } from '../src/auth/session'
import { sessionUrl, signInAnonymousUrl, signInSteamUrl, tokenUrl } from '../src/net/endpoints'

const ORIGIN = 'http://127.0.0.1:5178'
/** 账号 id 是 better-auth 随机生成的一串，名字只取末四位。 */
const USER_ID = 'wxYz0123456789abcdefGHJK'

function platformWith(answers: { session: unknown; signIn?: unknown; token?: unknown }) {
  const platform = createFakePlatform()
  platform.network.respondWith(sessionUrl(ORIGIN), answers.session)
  if (answers.signIn !== undefined) {
    platform.network.respondWith(signInAnonymousUrl(ORIGIN), answers.signIn)
  }
  if (answers.token !== undefined) platform.network.respondWith(tokenUrl(ORIGIN), answers.token)
  return platform
}

describe('开号', () => {
  it('没有 Steam 就走游客那条', async () => {
    const platform = platformWith({
      session: null,
      signIn: { user: { id: USER_ID } },
      token: { token: 'jwt-0' },
    })
    // 假平台上 steam 那一项是有的，但默认说「这台机器上没有 Steam」。
    expect(platform.steam.isAvailable()).toBe(false)
    const session = createAuthSession({ platform, origin: ORIGIN })

    expect(session.getSnapshot().provider).toBe('guest')
    await session.token()
    // 一次票据都不该取——取了就说明分流判错了。
    expect(platform.steam.ticketCount()).toBe(0)
  })

  it('没有会话就开一个游客号，名字取账号 id 的末四位', async () => {
    const platform = platformWith({
      session: null,
      signIn: { user: { id: USER_ID } },
      token: { token: 'jwt-1' },
    })
    const session = createAuthSession({ platform, origin: ORIGIN })
    expect(session.getSnapshot().status).toBe('signing-in')

    await expect(session.token()).resolves.toBe('jwt-1')
    expect(session.getSnapshot()).toMatchObject({
      status: 'ready',
      userId: USER_ID,
      name: '游客 GHJK',
      error: null,
    })
  })

  it('已经有会话就直接用它，不再开一次号', async () => {
    /*
     * 刻意**不给** `/sign-in/anonymous` 配答案：真去开号的话那条请求会 reject，
     * 这条用例就会失败。也就是说「没再开一次号」是被断言住的，不是靠读代码相信的。
     */
    const platform = platformWith({
      session: { user: { id: USER_ID } },
      token: { token: 'jwt-2' },
    })
    const session = createAuthSession({ platform, origin: ORIGIN })

    await expect(session.token()).resolves.toBe('jwt-2')
    expect(session.getSnapshot().userId).toBe(USER_ID)
  })

  it('开号被拒但会话其实已经有了，就回头再问一次——StrictMode 下两份会撞上', async () => {
    // 第一次问「我是谁」时还没有号，去开号又被拒（better-auth 不许重复开号），
    // 这时候真相是「别人已经替我开好了」，再问一次就有答案。
    const platform = createFakePlatform()
    let asked = 0
    const answers: Record<string, unknown> = { [tokenUrl(ORIGIN)]: { token: 'jwt-3' } }
    platform.network.requestJson = <T>(url: string): Promise<T> => {
      if (url === sessionUrl(ORIGIN)) {
        asked += 1
        return Promise.resolve((asked === 1 ? null : { user: { id: USER_ID } }) as T)
      }
      if (url === signInAnonymousUrl(ORIGIN)) return Promise.reject(new Error('HTTP 400'))
      const answer = answers[url]
      return answer === undefined ? Promise.reject(new Error('没配')) : Promise.resolve(answer as T)
    }
    const session = createAuthSession({ platform, origin: ORIGIN })

    await expect(session.token()).resolves.toBe('jwt-3')
    expect(session.getSnapshot().userId).toBe(USER_ID)
  })
})

describe('连不上', () => {
  it('两次都失败才认输，进错误态；重试能救回来', async () => {
    const platform = createFakePlatform()
    const session = createAuthSession({ platform, origin: ORIGIN })

    // 一个地址都没配答案，假网络一律 reject。
    await expect(session.token()).rejects.toThrow()
    const failed = session.getSnapshot()
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('连不上账号服务')

    platform.network.respondWith(sessionUrl(ORIGIN), { user: { id: USER_ID } })
    platform.network.respondWith(tokenUrl(ORIGIN), { token: 'jwt-4' })
    session.retry()
    expect(session.getSnapshot().status).toBe('signing-in')

    await expect(session.token()).resolves.toBe('jwt-4')
    expect(session.getSnapshot().status).toBe('ready')
  })

  it('状态变了会通知订阅者，退订之后不再通知', async () => {
    const platform = platformWith({
      session: { user: { id: USER_ID } },
      token: { token: 'jwt-5' },
    })
    const session = createAuthSession({ platform, origin: ORIGIN })
    let hits = 0
    const stop = session.subscribe(() => {
      hits += 1
    })

    await session.token()
    expect(hits).toBeGreaterThan(0)

    stop()
    const before = hits
    session.retry()
    await session.token()
    expect(hits).toBe(before)
  })
})

describe('Steam 登录', () => {
  const STEAM_USER_ID = 'steamUser0123456789ABCD'

  /** 一台开着 Steam 的机器，`/sign-in/steam` 按配好的答案回。 */
  function steamPlatform(
    answer: unknown = { user: { id: STEAM_USER_ID, name: 'Steam 玩家 ABCD' } },
  ) {
    const platform = createFakePlatform()
    platform.steam.setAvailable(true)
    platform.steam.setTicket('a1b2c3d4e5f60718')
    platform.network.respondWith(signInSteamUrl(ORIGIN), answer)
    platform.network.respondWith(tokenUrl(ORIGIN), { token: 'jwt-steam' })
    return platform
  }

  it('拿票据换会话，不走游客那条', async () => {
    const platform = steamPlatform()
    /*
     * 刻意**不给** `/sign-in/anonymous` 和 `get-session` 配答案：走岔了那两条会 reject，
     * 这条用例就会失败。也就是说「没去开游客号」是被断言住的。
     */
    const session = createAuthSession({ platform, origin: ORIGIN })

    await expect(session.token()).resolves.toBe('jwt-steam')
    expect(session.getSnapshot()).toMatchObject({
      status: 'ready',
      userId: STEAM_USER_ID,
      provider: 'steam',
      error: null,
    })
    expect(platform.steam.ticketCount()).toBe(1)
  })

  it('票据是现取的，而且真的发了出去', async () => {
    const platform = steamPlatform()
    platform.steam.setTicket('ffff0000ffff0000')
    let sent: string | null = null
    const real = platform.network.requestJson
    platform.network.requestJson = <T>(url: string, init?: { body?: string }): Promise<T> => {
      if (url === signInSteamUrl(ORIGIN) && init?.body !== undefined) {
        sent = (JSON.parse(init.body) as { ticket: string }).ticket
      }
      return real<T>(url, init)
    }
    const session = createAuthSession({ platform, origin: ORIGIN })

    await session.token()
    expect(sent).toBe('ffff0000ffff0000')
  })

  it('名字优先用本机 Steam 客户端报的昵称', async () => {
    const platform = steamPlatform()
    platform.steam.setPersonaName('小算菜')
    const session = createAuthSession({ platform, origin: ORIGIN })

    await session.token()
    // 服务端只存了「Steam 玩家 ABCD」这种占位，它不额外去问 Valve 要昵称。
    expect(session.getSnapshot().name).toBe('小算菜')
  })

  it('读不到昵称就用服务端那个占位，不会说成「游客」', async () => {
    const platform = steamPlatform()
    platform.steam.setPersonaName(null)
    const session = createAuthSession({ platform, origin: ORIGIN })

    await session.token()
    expect(session.getSnapshot().name).toBe('Steam 玩家 ABCD')
  })

  it('票据取不到时退回现成的会话，别把人整个挡在门外', async () => {
    const platform = steamPlatform()
    // Steam 客户端中途退了：票据取不到，但上一次登录留下的会话 cookie 还在。
    platform.steam.setTicket(null)
    platform.network.respondWith(sessionUrl(ORIGIN), { user: { id: STEAM_USER_ID } })
    const session = createAuthSession({ platform, origin: ORIGIN })

    await expect(session.token()).resolves.toBe('jwt-steam')
    expect(session.getSnapshot()).toMatchObject({ status: 'ready', userId: STEAM_USER_ID })
  })

  it('票据取不到、也没有现成会话，就进错误态', async () => {
    const platform = steamPlatform()
    platform.steam.setTicket(null)
    platform.network.respondWith(sessionUrl(ORIGIN), null)
    const session = createAuthSession({ platform, origin: ORIGIN })

    await expect(session.token()).rejects.toThrow()
    expect(session.getSnapshot()).toMatchObject({ status: 'failed', provider: 'steam' })
  })
})
