/**
 * Steam 登录走整条路（迁移第 35 条）：票据 → 会话 → JWT → 握手。
 *
 * 这一组**不换全局 fetch**：它跑在开发模式下（测试环境没配 `STEAM_WEB_API_KEY`，
 * 而 `DEV=1`），steamId 由票据算出来，一次外发请求都没有。
 * 「发给 Valve 的请求长什么样、各种答复怎么解读」在 steamTicket.test.ts 里单独验。
 *
 * 走真的 HTTP 而不是直接调 `auth.api.signInSteam`：要验的正是会话 cookie 写没写对、
 * `/api/auth/token` 认不认它、换出来的 JWT 握手时算不算数——这几件事只有过一遍电线才成立。
 */

import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { AUTH_BASE, TEST_ORIGIN } from './accounts'
import { Client, HELLO } from './helpers'

/** 两张形状合法、互不相同的票据。开发模式下它们各自对应一个固定的账号。 */
const TICKET_A = 'aaaa1111bbbb2222'
const TICKET_B = 'cccc3333dddd4444'

interface SignedIn {
  status: number
  userId: string
  /** 会话 cookie，拼好可以直接当 `Cookie` 头用。 */
  cookie: string
}

async function signInSteam(ticket: string, cookie?: string): Promise<SignedIn> {
  const response = await SELF.fetch(`${AUTH_BASE}/sign-in/steam`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: TEST_ORIGIN,
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify({ ticket }),
  })
  if (!response.ok) return { status: response.status, userId: '', cookie: '' }
  const { user } = (await response.json()) as { user: { id: string } }
  return {
    status: response.status,
    userId: user.id,
    // 可能不止一条（better-auth 还会放一条签名用的），全带上最省事（同 accounts.ts）。
    cookie: response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; '),
  }
}

/** 拿会话换一张握手用的 JWT。 */
async function tokenWith(cookie: string): Promise<string> {
  const response = await SELF.fetch(`${AUTH_BASE}/token`, { headers: { Cookie: cookie } })
  if (!response.ok) throw new Error(`换 JWT 失败（${response.status}）：${await response.text()}`)
  return ((await response.json()) as { token: string }).token
}

describe('Steam 登录', () => {
  it('票据换出来的 JWT 连大厅，welcome 里就是这个账号', async () => {
    const signedIn = await signInSteam(TICKET_A)
    expect(signedIn.status).toBe(200)

    const client = await Client.connectLobby(await tokenWith(signedIn.cookie))
    client.send(HELLO)
    const welcome = await client.expect('session:welcome')
    expect(welcome.userId).toBe(signedIn.userId)
    expect(welcome.place).toEqual({ kind: 'lobby' })
    client.close()
  })

  it('同一个 steamId 两次登录是同一个账号', async () => {
    const first = await signInSteam(TICKET_A)
    const again = await signInSteam(TICKET_A)
    // 这一条是整条路存在的意义：换台电脑、重装系统之后进度还在。
    expect(again.userId).toBe(first.userId)
    // 会话是新开的，账号才是同一个——两次的 cookie 不该恰好一样。
    expect(again.cookie).not.toBe(first.cookie)
  })

  it('不同 steamId 是不同账号', async () => {
    const alice = await signInSteam(TICKET_A)
    const bob = await signInSteam(TICKET_B)
    expect(bob.userId).not.toBe(alice.userId)
  })

  it('登录之后那个号不是游客号', async () => {
    const signedIn = await signInSteam(TICKET_B)
    const row = await env.AUTH_DB.prepare('SELECT isAnonymous FROM "user" WHERE id = ?')
      .bind(signedIn.userId)
      .first<{ isAnonymous: number | null }>()
    // 不是游客，所以 `anonymous` 插件不会把它当成「可以清理掉的临时号」。
    expect(row?.isAnonymous ?? 0).toBeFalsy()
  })

  it('steamId 记在 account 表的 steam 这一档下面', async () => {
    const signedIn = await signInSteam(TICKET_A)
    const row = await env.AUTH_DB.prepare(
      'SELECT accountId FROM account WHERE userId = ? AND providerId = ?',
    )
      .bind(signedIn.userId, 'steam')
      .first<{ accountId: string }>()
    // 不新开一张表：`account` 本来就是「这个用户在哪个外部身份下叫什么」。
    expect(row?.accountId).toMatch(/^dev-[0-9a-f]{32}$/)
  })

  it('先当游客再用 Steam 登录，换成 Steam 那个号', async () => {
    const guest = await SELF.fetch(`${AUTH_BASE}/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
      body: '{}',
    })
    const guestId = ((await guest.json()) as { user: { id: string } }).user.id
    const guestCookie = guest.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ')

    const signedIn = await signInSteam(TICKET_A, guestCookie)
    expect(signedIn.status).toBe(200)
    expect(signedIn.userId).not.toBe(guestId)
    /*
     * 游客那个号会被 `anonymous` 插件的钩子清掉（它看到有人从 /sign-in/* 换到了非游客会话）。
     * 这是对的：进度存在玩家本机（platform.storage），不跟着服务端的账号走。
     */
    const left = await env.AUTH_DB.prepare('SELECT id FROM "user" WHERE id = ?')
      .bind(guestId)
      .first()
    expect(left).toBeNull()
  })
})

describe('票据不对就进不来', () => {
  it('形状不对的票据回 401', async () => {
    for (const bad of ['', 'zzzz', 'a1b2']) {
      expect((await signInSteam(bad)).status).toBe(401)
    }
  })

  it('没有 ticket 字段回 400', async () => {
    const response = await SELF.fetch(`${AUTH_BASE}/sign-in/steam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
      body: '{}',
    })
    // 400 而不是 401：这是「请求写错了」，不是「你不是你说的那个人」。
    expect(response.status).toBe(400)
  })

  it('不是开发模式、又没配密钥时，谁都登不进来', async () => {
    // 线上漏配 STEAM_WEB_API_KEY 时的行为：失败关闭（见 src/auth/steamTicket.ts）。
    env.DEV = undefined
    try {
      expect((await signInSteam(TICKET_A)).status).toBe(401)
    } finally {
      // 这个开关整份测试共用，不放回去后面的用例会跟着换一套行为。
      env.DEV = '1'
    }
  })
})
