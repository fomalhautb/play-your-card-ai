/**
 * 手写的那部分 `Env`：密钥。
 *
 * 为什么不和别的绑定一起放 worker-configuration.d.ts：那份是
 * `pnpm --filter @ai-duel/server types` 生成的，只认 wrangler.jsonc 里声明过的绑定。
 * 密钥不在 wrangler.jsonc 里（本地在 .dev.vars，线上是 `wrangler secret put`），
 * 生成器看不见它。写在那份里下次一重新生成就没了，所以单独一份手写的和它合并。
 */

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
interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
