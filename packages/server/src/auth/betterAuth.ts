import { betterAuth } from 'better-auth'
import { anonymous, jwt } from 'better-auth/plugins'
import { JWT_ALGORITHM } from './verify'

/**
 * 账号系统：better-auth 配 Cloudflare D1（《正式版架构》5.5）。
 *
 * 眼下只开了**游客**一种登录方式：游戏打开就能玩，不填任何东西就有一个账号 id，
 * 座位、匹配、重连全靠它认人。邮箱 / OAuth 绑定和 Steam 票据换 JWT 是后面的事
 * （迁移第 35 条），`anonymous` 插件的 `onLinkAccount` 就是留给那一步把游客数据接过去的。
 *
 * 房间和大厅**不 import 这个文件**：它们只需要 `verify.ts` 里那个读公钥的验签函数。
 * 私钥、会话表、cookie 全部只在 `/api/auth/*` 这条路径上出现。
 *
 * 一个已知的口子留给客户端那几条（迁移第 27、31 条）：没有配 `trustedOrigins`，
 * 所以**跨源的登录请求会被 better-auth 挡掉**。线上前端和 Worker 同域没问题，
 * 本地开发时前端另起一个端口就会撞上，到时候把 dev 的地址加进 `trustedOrigins`。
 */

/** better-auth 的全部路由都挂在这个前缀下面。 */
export const AUTH_BASE_PATH = '/api/auth'

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
    secret: env.BETTER_AUTH_SECRET,
    // D1 绑定直接传：better-auth 1.5 起认得 D1（靠 batch/exec/prepare 这几个方法认），
    // 不需要再自己配 kysely-d1 或者 drizzle。
    // 注意 D1 没有交互式事务，better-auth 会退回用 batch() 保证原子性。
    database: env.AUTH_DB,
    // 遥测默认就是关的，明写一遍是因为 Worker 里任何一次意外的外发请求都要算钱和算时间。
    telemetry: { enabled: false },
    plugins: [
      anonymous(),
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
