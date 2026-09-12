/**
 * 跨源那道门：手机壳（Capacitor）的两个源进得来，别处进不来（迁移第 36 条）。
 *
 * 为什么要单独一组：手机壳里页面的源是 WebView 自己那个（iOS `capacitor://localhost`、
 * 安卓 `https://localhost`），改不成线上域名，所以账号那几条请求对服务端来说天生是跨源的。
 * better-auth 的 origin-check 中间件把它们挡掉的话，手机上连不上号——
 * 而这件事在本机跑不出来，只有在这里钉住（名单见 src/auth/betterAuth.ts 的
 * `MOBILE_TRUSTED_ORIGINS`）。
 *
 * 这一组全走 HTTP，不开 WebSocket：握手那条的凭据是子协议里的 JWT 不是 cookie，
 * 压根不经过这道门（那部分在 auth.test.ts 和 handshake.test.ts）。
 */

import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { AUTH_BASE } from './accounts'

/** iOS 那个源。`iosScheme` 默认 `capacitor`、`hostname` 默认 `localhost`。 */
const IOS_ORIGIN = 'capacitor://localhost'
/** 安卓那个源。`androidScheme` 从 Capacitor 5 起默认 `https`。 */
const ANDROID_ORIGIN = 'https://localhost'
/** 谁都不该信任的源。 */
const EVIL_ORIGIN = 'https://evil.example'

function headersWith(origin: string | null, cookie?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(origin === null ? {} : { Origin: origin }),
    ...(cookie === undefined ? {} : { Cookie: cookie }),
  }
}

/** 开一个游客账号。`origin` 传 null 表示这条请求**不带** Origin 头。 */
async function signIn(origin: string | null): Promise<Response> {
  return SELF.fetch(`${AUTH_BASE}/sign-in/anonymous`, {
    method: 'POST',
    headers: headersWith(origin),
    body: '{}',
  })
}

/** 把响应里的会话 cookie 收成一条请求头的样子。可能不止一条，全带上最省事。 */
function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ')
}

/**
 * 带着会话 cookie 再发一条 POST。
 *
 * 用登出这条是因为它是账号那几条路由里**唯一**「非 GET 且必然带 cookie」的一条
 *（换 JWT 和查会话都是 GET，GET 不进这道门）。而「带 cookie 的非 GET」正是
 * origin-check 真正会拦的那一类，见下面那条用例的说明。
 */
async function signOut(origin: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
    headers: headersWith(origin, cookie),
    body: '{}',
  })
}

describe('手机壳那两个源', () => {
  it('iOS 的 capacitor://localhost 登得进来，会话是真的', async () => {
    const response = await signIn(IOS_ORIGIN)
    expect(response.status).toBe(200)
    const { user } = (await response.json()) as { user: { id: string } }
    expect(user.id).toBeTruthy()

    // 光能登录还不够：带着 cookie 的后续请求才是真正会被这道门查的那一类，
    // 名单漏了的话玩家能进游戏、一登出就 403。
    expect((await signOut(IOS_ORIGIN, cookieOf(response))).status).toBe(200)
  })

  it('安卓的 https://localhost 一样', async () => {
    const response = await signIn(ANDROID_ORIGIN)
    expect(response.status).toBe(200)
    expect((await signOut(ANDROID_ORIGIN, cookieOf(response))).status).toBe(200)
  })
})

describe('别处的源', () => {
  it('带陌生 Origin、又带着会话 cookie 的请求被挡在门外', async () => {
    // 先正常拿一份会话（这一步用手机壳的源，和上面那组一样）。
    const session = await signIn(IOS_ORIGIN)
    const cookie = cookieOf(session)

    const response = await signOut(EVIL_ORIGIN, cookie)
    expect(response.status).toBe(403)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('INVALID_ORIGIN')
  })
})

describe('没有 Origin 头的请求', () => {
  /*
   * 这一条**钉的是现状，不是主张**。
   *
   * 原生 HTTP（手机壳的 `requestJson` 走 `CapacitorHttp`，见
   * packages/platform/src/capacitor/network.ts）不是浏览器发的，可能一个 Origin 头都不带。
   * better-auth 那边的规则是：**没有 cookie 的请求整条跳过来源检查**
   *（`validateOrigin` 里 `if (!(forceValidate || useCookies)) return`），
   * 所以第一次登录这种「无 cookie」的请求本来就查不到，带不带 Origin 都一样。
   *
   * 真正会查的是带 cookie 那一类，而那时缺 Origin 会被判成 `MISSING_OR_NULL_ORIGIN`。
   * 也就是说：**如果**原生 HTTP 真的不带 Origin，手机上登录能过、后续带 cookie 的
   * POST 会 403 —— 这一条正是用来把那个分界钉住的，真机验出来是哪种情况就照着改。
   */
  it('第一次登录（没有 cookie）不查来源，进得来', async () => {
    expect((await signIn(null)).status).toBe(200)
  })

  it('带着 cookie 却没有 Origin 的请求，被判成「缺来源」', async () => {
    const session = await signIn(IOS_ORIGIN)
    const response = await SELF.fetch(`${AUTH_BASE}/sign-out`, {
      method: 'POST',
      headers: headersWith(null, cookieOf(session)),
      body: '{}',
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('MISSING_OR_NULL_ORIGIN')
  })
})
