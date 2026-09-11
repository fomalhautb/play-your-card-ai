/**
 * 手写的那部分 `Env`：密钥、只有本地开发才有的那个开关，以及 Steam 那两项。
 *
 * 为什么不和别的绑定一起放 worker-configuration.d.ts：那份是
 * `pnpm --filter @ai-duel/server types` 生成的，只认 wrangler.jsonc 里声明过的绑定。
 * 密钥不在 wrangler.jsonc 里（本地在 .dev.vars，线上是 `wrangler secret put`），
 * 生成器看不见它。写在那份里下次一重新生成就没了，所以单独一份手写的和它合并。
 */

/**
 * 只有 `wrangler dev` 才读得到的开关（写在 .dev.vars 里，那个文件不进仓库）。
 *
 * 和密钥放在一起是因为来源相同：都是生成器看不见的东西。
 * 意思上不一样——密钥线上也有（`wrangler secret put`），这一条线上**必然没有**，
 * 「线上没有」正是它当环境判据的全部依据（见 src/devMode.ts）。
 */
interface DevVars {
  /**
   * 有值就是开发环境。管两件事：`room:error malformed` 回不回给客户端，
   * 以及没配 Steam 密钥时 Steam 登录收不收假票据（见 src/auth/steamTicket.ts）。
   *
   * 是可选的字符串而不是布尔：`.dev.vars` 里的每一行都是字符串，
   * 声明成布尔的话线上那个 undefined 反而对不上类型。
   */
  DEV?: string
}

/**
 * Steam 登录那条路要的两样（src/auth/steamTicket.ts）。
 *
 * 两样都是可选的：没有它们时 Steam 登录在本地开发下走「任何票据都收」，线上则一律拒绝
 *（失败关闭，理由见 steamTicket.ts 的那张表）。所以网页版和手机版部署时不配也能跑。
 */
interface SteamVars {
  /**
   * Steam 的**发行商** Web API 密钥，用来问 Valve「这张票是谁的」。
   *
   * 从 Steamworks 后台拿（合并前要做的事写在 docs/deploy.md），
   * 走 `wrangler secret put STEAM_WEB_API_KEY`。它是凭据，不能进仓库。
   */
  STEAM_WEB_API_KEY?: string
  /**
   * 这个游戏在 Steam 上的 appId。不配时用 480（Valve 的 SpaceWar，人人都「拥有」的试验田）。
   *
   * 它不是凭据，只是没地方放得更合适：`wrangler.jsonc` 的 `vars` 一改就要重新生成
   * worker-configuration.d.ts，而这份手写的声明本来就是给「生成器看不见的东西」准备的。
   * 客户端那边的 appId 是壳自己的环境变量（见 apps/steam/README.md），两处要填同一个数。
   */
  STEAM_APP_ID?: string
}

interface Secrets {
  /**
   * better-auth 的主密钥（src/auth/betterAuth.ts）。
   *
   * 它管两件事：给会话 cookie 签名，以及加密存在 D1 `jwks` 表里的那把私钥。
   * 所以**换掉它等于把已经生成的私钥变成解不开的一坨**——真要换，
   * 得连 `jwks` 表一起清掉，让 better-auth 重新生成一对密钥
   * （代价是所有已经发出去的 JWT 立刻作废，玩家重新登录一次）。
   *
   * 握手验签用的是公钥，从 D1 里读，不需要任何密钥（见 src/auth/verify.ts），
   * 所以房间和大厅对象碰不到这一条。
   */
  BETTER_AUTH_SECRET: string
}

/**
 * 生成的那份声明了两个同名接口：全局的 `Env`（`fetch` 的第二个参数用它）和
 * `Cloudflare.Env`（`cloudflare:test` 里那个 `env` 用它）。两个都得补上密钥，
 * 少补一个就会出现「源码里读得到、测试里读不到」这种莫名其妙的类型错。
 */
interface Env extends Secrets, DevVars, SteamVars {}

declare namespace Cloudflare {
  interface Env extends Secrets, DevVars, SteamVars {}
}
