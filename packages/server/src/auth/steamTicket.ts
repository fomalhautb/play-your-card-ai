import { z } from 'zod'
import { isDevEnv } from '../devMode'

/**
 * 验一张 Steam 会话票据，认出这是哪个 Steam 账号（《正式版架构》5.5）。
 *
 * 票据是客户端在 Steam 客户端里现取的（`ISteamUser::GetAuthTicketForWebApi`，
 * 见 apps/steam/src/steam.ts），我们拿它去问 Valve 的
 * `ISteamUserAuth/AuthenticateUserTicket`。**这一问是必须的**：票据本身是一段不透明的二进制，
 * 只有 Valve 验得了签名，客户端说自己是谁一律不算数。
 *
 * 这一层只回一个 steamId，不建账号也不发会话——那是 `auth/steam.ts` 里那个插件的事。
 *
 * ## 三种环境
 *
 * | `STEAM_WEB_API_KEY` | `DEV` | 行为 |
 * |---|---|---|
 * | 有 | 无所谓 | 真的去问 Valve |
 * | 没有 | 有 | **开发模式**：任何票据都收，steamId 由票据算出来（见 `devSteamId`） |
 * | 没有 | 没有 | 一律拒绝 |
 *
 * 判据先看密钥再看 `DEV`，不是反过来：本地开发时一旦配了真密钥就该走真的那条，
 * 不然「本机测得通、线上不通」这种事要到上线才发现。最后那一格是**失败关闭**——
 * 线上漏配密钥时，宁可谁都登不进来，也不能变成「随便递一段字符串就是一个新账号」。
 */

/** 发给 Valve 的域名。`api.steampowered.com` 那个同名接口有更严的频率限制，用发行商专用的这个。 */
const STEAM_AUTH_ENDPOINT =
  'https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/'

/**
 * 取票据时传给 Steam 的「这张票是发给谁的」。
 *
 * 客户端那边写着同一个字面量（apps/steam/src/config.ts 的 `STEAM_TICKET_IDENTITY`），
 * 两处必须一样：Valve 会拿它比对，对不上整张票作废。
 * 跨包只走包入口（架构 7.2 第 2 条），而 `apps/steam` 是壳、`server` 是服务端，
 * 谁也不该依赖谁，所以只能各写一份。
 */
export const STEAM_TICKET_IDENTITY = 'playyourcardai'

/**
 * 没配 `STEAM_APP_ID` 时用的 appId：480 是 Valve 的 SpaceWar，
 * 每个 Steam 账号都「拥有」它，所以它是所有 Steam 接入的通用试验田。
 * 真上线前必须换成自己的（见 apps/steam/README.md）。
 */
const DEFAULT_STEAM_APP_ID = '480'

/**
 * 票据长度的上下限（十六进制字符数）。
 *
 * 真票据是一千多个十六进制字符。上限主要是防着「有人往这个端点灌几兆字符串」——
 * 那样每一次都会变成一次真的外发请求。下限只是挡掉空串和明显的乱填。
 */
const TICKET_MIN_LENGTH = 8
const TICKET_MAX_LENGTH = 4096

/** 只收十六进制：`getBytes()` 出来的是二进制，客户端按约定转成十六进制串（见 apps/steam）。 */
const ticketSchema = z
  .string()
  .min(TICKET_MIN_LENGTH)
  .max(TICKET_MAX_LENGTH)
  .regex(/^[0-9a-fA-F]+$/)

/**
 * Valve 的答复。
 *
 * 票据不对时它回的**也是 200**，只是 `response` 里换成一个 `error` 对象、没有 `params`。
 * 所以 `params` 是可选的，「没有 params」就是「这张票不行」。
 *
 * 每一层都用 `looseObject`（多出来的字段照收）：Valve 时不时会给答复加字段，
 * 严格模式会让一次和我们无关的扩展把所有人挡在门外。
 */
const steamResponseSchema = z.looseObject({
  response: z.looseObject({
    params: z
      .looseObject({
        result: z.string(),
        steamid: z.string(),
        ownersteamid: z.string().optional(),
        vacbanned: z.boolean().optional(),
        publisherbanned: z.boolean().optional(),
      })
      .optional(),
  }),
})

/** steamId 是一个 64 位整数的十进制写法，永远是纯数字。 */
const STEAM_ID_PATTERN = /^\d{1,20}$/

/**
 * 开发模式下的假 steamId：把票据摘要成一串十六进制，前面加 `dev-`。
 *
 * 两条性质是测试和本地开发都要的：同一张票据**永远**算出同一个账号（「上次那个号」还在），
 * 不同票据算出不同账号（本机开两个进程能当两个人对打）。
 *
 * 前缀 `dev-` 不是装饰：真 steamId 是纯数字，加了前缀之后，开发期攒下来的账号
 * 和真账号在 `account` 表里永远撞不到一起——哪天这个库被带上线也不会认错人。
 */
async function devSteamId(ticket: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `dev-${hex.slice(0, 32)}`
}

/** 问 Valve 这张票是谁的。网络出错、答复看不懂、Valve 说不行，一律 null。 */
async function askSteam(ticket: string, key: string, appId: string): Promise<string | null> {
  const url = new URL(STEAM_AUTH_ENDPOINT)
  url.searchParams.set('key', key)
  url.searchParams.set('appid', appId)
  url.searchParams.set('ticket', ticket)
  url.searchParams.set('identity', STEAM_TICKET_IDENTITY)

  let payload: unknown
  try {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) return null
    payload = await response.json()
  } catch {
    // Valve 挂了 / 网络不通。对调用方来说和「这张票不对」一样是「进不来」，
    // 分开报只会给试探的人多一点信息（同 verify.ts 的那条纪律）。
    return null
  }

  const parsed = steamResponseSchema.safeParse(payload)
  if (!parsed.success) return null
  const params = parsed.data.response.params
  if (params === undefined || params.result !== 'OK') return null
  if (!STEAM_ID_PATTERN.test(params.steamid)) return null
  /*
   * 被我们自己封过的号不放进来。VAC 封禁（`vacbanned`）**不拦**：那是别的游戏里作的弊，
   * 和这里没关系，拦了只会误伤。
   * 家庭共享（`ownersteamid` 和 `steamid` 不一样）也不拦：这个游戏不是付费买断的，
   * 「这份授权是谁的」对我们没有意义。
   */
  if (params.publisherbanned === true) return null
  return params.steamid
}

/**
 * 验票据，返回 steamId；任何一处不对都返回 null，不抛异常也不区分原因。
 *
 * 不区分原因和 `verifyToken` 是同一条纪律：过期、伪造、Valve 不通，对调用方来说
 * 都是「这个人进不来」。真要排查线上问题看日志。
 */
export async function verifySteamTicket(ticket: string, env: Env): Promise<string | null> {
  if (!ticketSchema.safeParse(ticket).success) return null

  const key = env.STEAM_WEB_API_KEY
  if (key !== undefined && key !== '') {
    return askSteam(ticket, key, env.STEAM_APP_ID ?? DEFAULT_STEAM_APP_ID)
  }
  if (!isDevEnv(env)) return null
  return devSteamId(ticket)
}
