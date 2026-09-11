import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import { verifySteamTicket } from './steamTicket'

/**
 * Steam 登录：一条 `POST /api/auth/sign-in/steam`，拿票据换一个会话（《正式版架构》5.5）。
 *
 * ## 为什么是一个 better-auth 插件，不是自己开一条路由
 *
 * 会话这件事上要做对的细节不少：cookie 的名字和 `__Secure-` 前缀、签名、过期、
 * 和 `/api/auth/token` 那条换 JWT 的路能对上、和 `anonymous` 插件的「登录后清理游客号」
 * 钩子能对上。自己在 better-auth 外面开一条路由就要把这些全抄一遍，而且每次升级都要跟着改。
 * 写成插件之后，这条路和 `/sign-in/anonymous` 走的是同一套（这个文件几乎就是照着
 * better-auth 自己的 `anonymous` 和 `siwe` 两个插件写的）。
 *
 * ## 账号怎么认
 *
 * steamId 记在 better-auth 自带的 `account` 表里，`providerId` 固定是 `'steam'`，
 * `accountId` 就是 steamId。不新开一张表：这张表本来就是「这个用户在哪个外部身份下叫什么」，
 * 建表语句（migrations/0001_auth.sql）里早就有它，一行都不用改。
 *
 * ## 和游客号的关系
 *
 * 玩家可能先当游客玩了一阵再用 Steam 登录。那时 `anonymous` 插件的钩子会看到
 * 「刚有人从 `/sign-in/*` 换到了一个非游客会话」，把那个游客账号删掉。
 * 这是对的：进度存在**本机**（`platform.storage`），不跟着服务端的账号走，所以什么都不会丢。
 * 真要把游客的服务端数据接过去，是给 `anonymous({ onLinkAccount })` 补一个回调的事，
 * 留到真有服务端存档的时候再说。
 */

/** `account` 表里给 Steam 用的 providerId。改它等于把所有已有的 Steam 绑定作废。 */
const STEAM_PROVIDER_ID = 'steam'

/**
 * 给 Steam 账号编的邮箱。
 *
 * `user` 表的 `email` 是 **not null unique**（better-auth 的建表语句就是这样），
 * 而 Steam 不给我们邮箱。所以按 steamId 编一个必然唯一、又必然投不出去的地址：
 * `.invalid` 是 RFC 2606 保留的顶级域，永远不会被注册，也就不可能真的发信出去。
 */
function placeholderEmail(steamId: string): string {
  return `${steamId}@steam.invalid`
}

/**
 * 给人看的名字。
 *
 * Steam 昵称不从这里来——客户端报的名字不能信，而 `AuthenticateUserTicket` 只回 steamId，
 * 不回昵称（要昵称得再调一次 `ISteamUser/GetPlayerSummaries`，多一次外发请求换一个装饰性的字段）。
 * 所以服务端存的是「Steam 玩家 <后四位>」这种可辨认的占位，界面上真正显示的昵称由客户端
 * 自己从本机的 Steam 客户端读（见 platform 的 `steam.personaName()`）。
 */
function displayName(steamId: string): string {
  return `Steam 玩家 ${steamId.slice(-4)}`
}

const bodySchema = z.object({
  /** 十六进制的会话票据。真票据一千多个字符，具体的长度和格式检查在 steamTicket.ts。 */
  ticket: z.string(),
})

export function steamAuth(env: Env): BetterAuthPlugin {
  return {
    id: 'steam',
    endpoints: {
      signInSteam: createAuthEndpoint(
        '/sign-in/steam',
        { method: 'POST', body: bodySchema },
        async (ctx) => {
          const steamId = await verifySteamTicket(ctx.body.ticket, env)
          // 401 而不是 400：这是「你不是你说的那个人」，不是「你的请求写错了」。
          if (steamId === null) {
            throw new APIError('UNAUTHORIZED', { message: 'Steam 票据验不过' })
          }

          const { internalAdapter } = ctx.context
          const owner = await internalAdapter.findAccountOwnerByKey({
            providerId: STEAM_PROVIDER_ID,
            accountId: steamId,
          })

          /*
           * 认得这个 steamId 就直接用那个账号——「同一个 Steam 账号永远是同一个游戏账号」
           * 是这条路的全部意义（换台电脑、重装系统之后进度还在）。
           *
           * `kind: 'orphaned'` 是绑定还在、用户行没了（手工删过库）。那种情况当成新玩家重新建，
           * 旧的那行绑定会被下面的 `createOAuthUser` 顶掉。
           */
          const user =
            owner?.kind === 'owned'
              ? owner.user
              : (
                  await internalAdapter.createOAuthUser(
                    {
                      email: placeholderEmail(steamId),
                      emailVerified: false,
                      name: displayName(steamId),
                    },
                    { providerId: STEAM_PROVIDER_ID, accountId: steamId },
                  )
                ).user

          const session = await internalAdapter.createSession(user.id)
          // 会话 cookie 由 better-auth 自己按当前配置写（名字、签名、`__Secure-` 前缀、过期）。
          // 写完之后客户端那条 `/api/auth/token` 就能拿它换握手用的 JWT，和游客那条路完全一样。
          await setSessionCookie(ctx, { session, user })

          return ctx.json({ user: { id: user.id, name: user.name } })
        },
      ),
    },
  }
}
