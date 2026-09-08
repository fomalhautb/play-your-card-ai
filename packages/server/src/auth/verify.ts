import type { JSONWebKeySet, JWTPayload, JWTVerifyGetKey } from 'jose'
import { createLocalJWKSet, decodeProtectedHeader, errors, jwtVerify } from 'jose'

/**
 * 验一张 WebSocket 握手里带上来的 JWT，认出这是哪个账号。
 *
 * 这是整个服务端唯一的身份来源：座位、能不能进房、指令算谁发的，全部从这里的返回值推出来
 * （《正式版架构》5.5）。客户端说自己是谁一律不算数。
 *
 * 签发方是 better-auth 的 jwt 插件（src/auth/betterAuth.ts），用的是**非对称**密钥：
 * 私钥只有 `/api/auth` 那条路径上的 better-auth 碰得到，房间和大厅这边只读公钥。
 * 两边不共享任何秘密——所以这个文件里没有、也不需要任何密钥。
 *
 * 公钥从 D1 的 `jwks` 表直接读，**不走 HTTP 回自己**：Durable Object 打自己的
 * `/api/auth/jwks` 要绕一圈出口再进来，多一次网络往返不说，Worker 请求自己这件事
 * 本身也容易撞上平台的循环调用限制。D1 绑定在 DO 里直接可用，查一次就完事。
 */

/**
 * 签发和验签钉死这一种算法。
 *
 * `algorithms` 不钉死的话，攻击者可以把 token 头部改成 `alg: none`，或者换成 HS256
 * 再拿公钥当共享密钥去签——两种都是教科书级的 JWT 绕过。
 * EdDSA（Ed25519）是 better-auth jwt 插件的默认算法，签名只有 64 字节，
 * 而 token 是塞在 `Sec-WebSocket-Protocol` 头里带上来的，短一点有好处。
 */
export const JWT_ALGORITHM = 'EdDSA'

/**
 * 账号 id 的长度上限，和 protocol 的 `welcomeSchema` 里那条 `.max()` 一样。
 *
 * 超长的 sub 在这里就当验不过：它会原样进 `session:welcome`，
 * 而那条消息在客户端是要过 schema 的，长了整条消息作废，玩家只会看到一个莫名其妙的失败。
 * 与其让错误跑到客户端才炸，不如在门口就拒掉。
 */
const USER_ID_MAX_LENGTH = 64

/**
 * 公钥集在内存里缓存多久。
 *
 * 缓存是必须的：不缓存的话每次握手都要查一次 D1，而握手是玩家进游戏的第一步。
 * 一分钟这个数是拿「密钥被删掉之后最坏还要多久才生效」换来的——better-auth 签出来的
 * token 本身只活 15 分钟，缓存再拖一分钟不会把作废的密钥拖出多长的尾巴。
 */
const JWKS_TTL_MS = 60_000

/**
 * 一份缓存里最多记住多少个「查过、确实不存在」的 kid，见 `rememberUnknown`。
 *
 * 有上限是因为这个集合的内容由外面的人决定：不封顶的话，一串 kid 每次都不一样的请求
 * 就能把它撑大到吃光内存。满了就不再记，退化成每次都重查一次 D1，不会出错只是慢一点。
 */
const UNKNOWN_KID_MEMO_MAX = 256

/** 验过之后确定下来的身份。眼下只有账号 id，将来接了昵称、Steam 绑定可能会多几样。 */
export interface Identity {
  userId: string
}

/** `jwks` 表里我们用得到的几列，建表语句在 migrations/0001_auth.sql。 */
interface JwksRow {
  id: string
  publicKey: string
  alg: string | null
  crv: string | null
}

interface KeySetCache {
  resolve: JWTVerifyGetKey
  loadedAt: number
  /**
   * 拿这一份公钥集查过、确实没有的 kid。
   *
   * 作用是挡住重复的坏 token：客户端断线重连是自动的，一张密钥已经不在了的 token
   * 会被同一个人一秒内送来好几次，没有这个记号每次都要白查一遍 D1。
   * 第一次见到的 kid 仍然会去查（新密钥就是这么被认出来的），只有查过没有的才记。
   */
  unknown: Set<string>
}

/**
 * 模块级缓存，一个 isolate 一份。
 *
 * 房间对象、大厅对象、总路由跑在同一份代码里，共用这一份缓存正合适：
 * 它跟着 isolate 一起被回收，不需要谁去清理。
 */
let cache: KeySetCache | null = null

/**
 * 把 `jwks` 表整表读出来拼成一个 JWKS。
 *
 * 表里正常只有一行（我们没开 `rotationInterval`，better-auth 不会自己轮换密钥）。
 * 不按 `expiresAt` 过滤：一张 token 能活多久由它自己的 `exp` 兜着，
 * 而真正作废的密钥应该是被删掉的那种，还留在表里就还算数。
 *
 * 拼法照抄 better-auth 自己那条 `/jwks` 路由：`alg`、`crv` 各占一列，
 * 公钥 JWK 的其余部分是 `publicKey` 那一列里的 JSON，`kid` 就是这一行的主键。
 */
async function loadKeySet(env: Env): Promise<KeySetCache> {
  const { results } = await env.AUTH_DB.prepare(
    'SELECT id, publicKey, alg, crv FROM jwks',
  ).all<JwksRow>()
  const keys = results.map((row) => ({
    alg: row.alg ?? JWT_ALGORITHM,
    ...(row.crv === null ? {} : { crv: row.crv }),
    ...(JSON.parse(row.publicKey) as Record<string, unknown>),
    kid: row.id,
  }))
  const fresh: KeySetCache = {
    resolve: createLocalJWKSet({ keys } as JSONWebKeySet),
    loadedAt: Date.now(),
    unknown: new Set(),
  }
  cache = fresh
  return fresh
}

/** 手上这份还新鲜就用它，过期了或者还没有就重新读一份。 */
async function currentKeySet(env: Env): Promise<KeySetCache> {
  if (cache !== null && Date.now() - cache.loadedAt < JWKS_TTL_MS) return cache
  return loadKeySet(env)
}

/** 这个错误是不是「这张 token 的 kid 不在我手上的公钥集里」。 */
function isUnknownKey(error: unknown): boolean {
  return error instanceof errors.JWKSNoMatchingKey
}

/** 取 token 头里的 kid，取不到（比如整个 token 就是一段乱码）返回 null。 */
function kidOf(token: string): string | null {
  try {
    return decodeProtectedHeader(token).kid ?? null
  } catch {
    return null
  }
}

function rememberUnknown(keySet: KeySetCache, kid: string | null): void {
  if (kid === null) return
  if (keySet.unknown.size >= UNKNOWN_KID_MEMO_MAX) return
  keySet.unknown.add(kid)
}

/**
 * 验签并拿到载荷，验不过一律 null。
 *
 * 认不出 kid 时会重查一次 D1 再试一遍，这条路是给**新密钥**留的：
 * better-auth 是第一次有人要 token 时才生成密钥的，那一刻我们缓存里还没有它；
 * 密钥换掉之后同理。查完还是没有就把这个 kid 记下来，同一张坏 token 再来不必再查。
 */
async function verifyPayload(token: string, env: Env): Promise<JWTPayload | null> {
  const kid = kidOf(token)
  const cached = await currentKeySet(env)
  try {
    return (await jwtVerify(token, cached.resolve, { algorithms: [JWT_ALGORITHM] })).payload
  } catch (error) {
    if (!isUnknownKey(error)) return null
    if (kid !== null && cached.unknown.has(kid)) return null
  }

  const reloaded = await loadKeySet(env)
  try {
    return (await jwtVerify(token, reloaded.resolve, { algorithms: [JWT_ALGORITHM] })).payload
  } catch (error) {
    if (isUnknownKey(error)) rememberUnknown(reloaded, kid)
    return null
  }
}

/**
 * 验签 + 解出账号 id。任何一处不对都返回 null，不抛异常也不区分原因。
 *
 * 不区分原因是有意的：过期、签名错、算法不对、少了 sub，对调用方来说都是「这个人进不来」，
 * 分开报只会给试探的人多一点信息。真要排查线上问题看日志，不看返回值。
 *
 * 不校验 `iss` / `aud`：它们默认等于 better-auth 的 `baseURL`，而 `baseURL` 是按请求的
 * 域名推出来的（本地 127.0.0.1、线上两个域名、测试里又是另一个），钉死哪一个都会误伤。
 * 少这一道也不松：能签出这张 token 的私钥只有我们自己那一把。
 */
export async function verifyToken(token: string, env: Env): Promise<Identity | null> {
  const payload = await verifyPayload(token, env)
  if (payload === null) return null
  const userId = payload.sub
  if (typeof userId !== 'string') return null
  if (userId.length === 0 || userId.length > USER_ID_MAX_LENGTH) return null
  return { userId }
}
