/**
 * 手写的那部分 `Env`：密钥。
 *
 * 为什么不和别的绑定一起放 worker-configuration.d.ts：那份是
 * `pnpm --filter @ai-duel/server types` 生成的，只认 wrangler.jsonc 里声明过的绑定。
 * 密钥不在 wrangler.jsonc 里（本地在 .dev.vars，线上是 `wrangler secret put`），
 * 生成器看不见它。写在那份里下次一重新生成就没了，所以单独一份手写的和它合并。
 */

interface Env {
  /**
   * 验 WebSocket 握手里那张 JWT 的密钥（HS256，见 src/auth/verify.ts）。
   *
   * 本 PR 是自己签自己验，迁移第 25 条换成 better-auth 签发之后这一条大概率会换成
   * 一份公钥或一段 better-auth 的配置，届时连同 verify.ts 一起改。
   */
  JWT_SECRET: string
}
