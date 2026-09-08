/**
 * 测试要用的账号和 token，全部从**真的签发方**拿：走 `/api/auth/*` 的游客登录，
 * 再用会话换一张 JWT（和客户端将来干的事一模一样）。
 *
 * 这里**没有**「测试专用签发」那条后门：以前那版是测试自己拿共享密钥 HS256 签一张，
 * 结果验签那条路只有测试走过，签发方一换就全瞎了。现在正例只有一条路，
 * 和线上是同一条；下面那几个反例也都是拿真密钥或真 kid 去伪造的，不绕开任何检查。
 *
 * 测试里的账号 id 是 better-auth 随机生成的，事先不知道，所以对外露的是
 * 「标签」这一层：`tokenFor('alice')` 和 `accountId('alice')` 说的是同一个账号。
 */

import { env, SELF } from 'cloudflare:test'
import { base64url, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose'
import { AUTH_BASE_PATH, createAuth } from '../src/auth/betterAuth'
import { JWT_ALGORITHM } from '../src/auth/verify'

/** 测试里这个 Worker 的域名。`SELF.fetch` 用什么域名都行，统一一个省得对不上。 */
export const TEST_ORIGIN = 'https://duel.test'

/** better-auth 那几条路由的前缀。 */
export const AUTH_BASE = `${TEST_ORIGIN}${AUTH_BASE_PATH}`

interface Account {
  userId: string
  token: string
}

/**
 * 标签到账号的对应关系，一个测试文件一份。
 *
 * 缓存跨用例复用是有意的：这个 pool 每条用例跑完会把存储回滚，账号那几行会没掉，
 * 但**JWT 是自包含的**——房间验签只看签名和 `sub`，不查账号表，
 * 所以上一条用例拿到的 token 在下一条里照样能用。密钥那一行在 setup 里生成，回滚不掉。
 */
const accounts = new Map<string, Account>()

async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what}失败（${response.status}）：${await response.text()}`)
  return (await response.json()) as T
}

/** 开一个新的游客账号，返回它的 id 和一张能用的 JWT。 */
async function openAccount(): Promise<Account> {
  const signIn = await SELF.fetch(`${AUTH_BASE}/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
    body: '{}',
  })
  const { user } = await readJson<{ user: { id: string } }>(signIn, '游客登录')
  // 会话在 cookie 里。可能不止一条（better-auth 还会放一条签名用的），全带上最省事。
  const cookie = signIn.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ')
  const issued = await SELF.fetch(`${AUTH_BASE}/token`, { headers: { Cookie: cookie } })
  const { token } = await readJson<{ token: string }>(issued, '换 JWT')
  return { userId: user.id, token }
}

async function accountFor(label: string): Promise<Account> {
  const known = accounts.get(label)
  if (known !== undefined) return known
  const fresh = await openAccount()
  accounts.set(label, fresh)
  return fresh
}

/** 这个标签对应的账号的 JWT，握手时塞进子协议里的就是它。 */
export async function tokenFor(label: string): Promise<string> {
  return (await accountFor(label)).token
}

/** 这个标签对应的账号 id，建房名单和 `session:welcome` 里出现的就是它。 */
export async function accountId(label: string): Promise<string> {
  return (await accountFor(label)).userId
}

/** 现在这把签名密钥的 kid。伪造 token 要用它——不带对的 kid 连签名都轮不到验。 */
async function currentKid(): Promise<string> {
  const row = await env.AUTH_DB.prepare('SELECT id FROM jwks LIMIT 1').first<{ id: string }>()
  if (row === null) throw new Error('jwks 表里还没有密钥，setup 那一步没跑？')
  return row.id
}

/**
 * 换一把签名密钥：把现有的删掉，再让 better-auth 生成一把新的。
 *
 * 用在「缓存会不会把新密钥挡在外面」「旧 token 是不是立刻失效」这两条上。
 * 注意它把服务端内存里那份公钥集缓存也带偏了，所以用它的测试要放在文件最后
 * （见 auth.test.ts 里那一段说明）。
 */
export async function rotateSigningKey(): Promise<void> {
  await env.AUTH_DB.prepare('DELETE FROM jwks').run()
  const regenerated = await SELF.fetch(`${AUTH_BASE}/jwks`)
  await readJson(regenerated, '重新生成签名密钥')
}

/**
 * 拿一把**外来**私钥签一张，但 kid 写成真的那个。
 *
 * 这是伪造 token 最像样的一种：kid 对得上，服务端会真的去拿公钥验一次，
 * 挡住它的是签名本身对不上，不是「找不到密钥」。
 */
export async function forgedToken(label: string): Promise<string> {
  const { privateKey } = await generateKeyPair(JWT_ALGORITHM, { crv: 'Ed25519' })
  return new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid: await currentKid() })
    .setSubject(await accountId(label))
    .setExpirationTime('5m')
    .sign(privateKey)
}

/** 换成对称算法签一张（拿公钥当共享密钥那种绕过），算法钉死之后应该连试都不试。 */
export async function symmetricToken(label: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', kid: await currentKid() })
    .setSubject(await accountId(label))
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('不管拿什么当密钥都不该被接受'))
}

/** `alg: none`，根本没有签名的那种。 */
export async function unsecuredToken(label: string): Promise<string> {
  return new UnsecuredJWT({})
    .setSubject(await accountId(label))
    .setExpirationTime('5m')
    .encode()
}

/**
 * 拿一张**真**token 改载荷再拼回去，签名原样留着。
 *
 * 冒充别人最省事的想法就是这个：把 `sub` 换成对方的账号 id。
 */
export async function tamperedToken(label: string, impersonate: string): Promise<string> {
  const [header, payload, signature] = (await tokenFor(label)).split('.')
  const claims = JSON.parse(new TextDecoder().decode(base64url.decode(payload ?? '')))
  claims.sub = await accountId(impersonate)
  const forged = base64url.encode(new TextEncoder().encode(JSON.stringify(claims)))
  return `${header}.${forged}.${signature}`
}

/**
 * 拿**真**密钥签一张载荷随我们写的 token。
 *
 * 走的是 better-auth 自己的 `signJWT`——它只开给服务端代码，没挂在 HTTP 上，
 * 所以这不是给测试开的后门，签发用的还是库里那把真私钥。
 * 「真密钥 + 载荷有问题」这个组合没有别的办法造得出来，而它恰恰是最该验的一类：
 * 密钥没泄漏不等于每张 token 都该放行。
 */
async function signWithRealKey(payload: Record<string, unknown>): Promise<string> {
  const { token } = await createAuth(env, TEST_ORIGIN).api.signJWT({ body: { payload } })
  return token
}

/** 真密钥签的，但 `exp` 已经过去了。token 泄漏之后至少要能随时间失效。 */
export async function expiredToken(label: string): Promise<string> {
  return signWithRealKey({
    sub: await accountId(label),
    exp: Math.floor(Date.now() / 1000) - 60,
  })
}

/** 真密钥签的，但 `sub` 长得超出了协议允许的账号 id 长度。 */
export async function oversizedSubjectToken(): Promise<string> {
  return signWithRealKey({ sub: 'x'.repeat(200) })
}
