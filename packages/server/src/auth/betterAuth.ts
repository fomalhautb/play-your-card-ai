import { betterAuth } from 'better-auth'
import { anonymous, jwt } from 'better-auth/plugins'
import { isDevEnv } from '../devMode'
import { steamAuth } from './steam'
import { JWT_ALGORITHM } from './verify'

/**
 * 账号系统：better-auth 配 Cloudflare D1（《正式版架构》5.5）。
 *
 * 两种登录方式：**游客**（游戏打开就能玩，不填任何东西就有一个账号 id）和 **Steam**
 * （拿 Steam 客户端给的会话票据换会话，迁移第 35 条，见 auth/steam.ts）。
 * 座位、匹配、重连认的都是同一个账号 id，两条路进来之后完全一样。
 * 邮箱 / OAuth 绑定还没做；`anonymous` 插件的 `onLinkAccount` 是留给
 *「把游客攒下的服务端数据接到正式账号上」那一步的，现在进度只存在本机，还用不上。
 *
 * 房间和大厅**不 import 这个文件**：它们只需要 `verify.ts` 里那个读公钥的验签函数。
 * 私钥、会话表、cookie 全部只在 `/api/auth/*` 这条路径上出现。
 *
 * 跨源那道门（`trustedOrigins`）只在本地开发时放宽，见下面 `devTrustedOrigins`。
 */

/** better-auth 的全部路由都挂在这个前缀下面。 */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * 本地开发时额外信任的来源。**线上返回空数组**（判据见 devMode.ts）。
 *
 * 为什么要这一条：better-auth 的 origin-check 中间件会拿请求的 `Origin` 头和这份名单
 *（`baseURL` 自己那个源永远在名单里）比对，对不上就整条回 403 `INVALID_ORIGIN`。
 * 它不是每条请求都查——只查**带着 cookie 的非 GET 请求**，而玩家一旦开过号，
 * 之后每条 POST 都带着会话 cookie，正好全在这道门里。
 *
 * 线上前端和 Worker 是同一个 Worker、同一个域名，Origin 和 baseURL 天生对得上。
 * 本地开发对不上，而且有两层原因，缺一条都以为不需要这份名单：
 * 1. 页面来自 Vite（默认 5174，端到端另起一个端口），请求经代理转到 wrangler 的 8787；
 * 2. `wrangler dev` 会按 wrangler.jsonc 里那条 `routes` 把请求的 URL 重写成正式域名，
 *    所以 Worker 里读到的 `baseURL` 干脆是 `http://playyourcardai.online`，
 *    连 8787 都不是（同一个原因让本地签出的 JWT 里 `iss` 也是正式域名，见 verify.ts）。
 *
 * 端口写成通配是因为端口本来就会变（`PORT=xxx pnpm dev`、端到端那份配置、
 * 另一个工作树同时开着），一个个列出来只会漏。主机名不通配：只认这两个回环地址。
 */
function devTrustedOrigins(env: Env): string[] {
  return isDevEnv(env) ? ['http://localhost:*', 'http://127.0.0.1:*'] : []
}

/**
 * 每个请求现造一个 auth 实例。
 *
 * 不能在模块顶层建好：`env`（D1 绑定、密钥）是 `fetch` 的参数，模块加载时还没有。
 * 现造的代价只是拼几个对象，真正花时间的是 D1 查询，那部分反正每次都要做。
 *
 * `baseURL` 由调用方从请求 URL 推出来（本地是 127.0.0.1:8787，线上是正式域名）。
 * 不写死是因为这个 Worker 挂着两个域名，再加上本地和测试，写死哪一个都会有地方对不上。
 * 推出来的这一份仍然管用：better-auth 拿它比对请求的 `Origin` 头，
 * 别的站点从浏览器发过来的请求 origin 对不上，照样被挡。
 */
export function createAuth(env: Env, baseURL: string) {
  return betterAuth({
    appName: '出牌吧AI',
    baseURL,
    // 默认就是 /api/auth，写出来是因为 wrangler.jsonc 的 run_worker_first 和
    // src/index.ts 的路由前缀都得和它对上，三处改一处就得一起改。
    basePath: AUTH_BASE_PATH,
    // 线上这一项是空的，也就是只信 baseURL 自己那个源（见 devTrustedOrigins）。
    trustedOrigins: devTrustedOrigins(env),
    secret: env.BETTER_AUTH_SECRET,
    // D1 绑定直接传：better-auth 1.5 起认得 D1（靠 batch/exec/prepare 这几个方法认），
    // 不需要再自己配 kysely-d1 或者 drizzle。
    // 注意 D1 没有交互式事务，better-auth 会退回用 batch() 保证原子性。
    database: env.AUTH_DB,
    // 遥测默认就是关的，明写一遍是因为 Worker 里任何一次意外的外发请求都要算钱和算时间。
    telemetry: { enabled: false },
    plugins: [
      anonymous(),
      // 密钥和 appId 从 env 来，而 env 是 fetch 的参数，所以插件也只能每个请求现造一个。
      steamAuth(env),
      jwt({
        jwks: {
          // 和 verify.ts 用同一个常量：签发和验签的算法必须是同一种，
          // 分开写成两个字面量迟早会有一边改漏。
          keyPairConfig: { alg: JWT_ALGORITHM, crv: 'Ed25519' },
        },
        jwt: {
          /**
           * 载荷只留 better-auth 自己会加的那几项（`sub` 是账号 id）。
           *
           * 默认行为是把整个 user 对象塞进去（邮箱、昵称、头像……），
           * 而这张 token 是塞在 `Sec-WebSocket-Protocol` 请求头里带上来的——
           * 头太长会被中间层直接拒掉，而且服务端除了 `sub` 一样都用不上。
           */
          definePayload: () => ({}),
        },
      }),
    ],
  })
}
