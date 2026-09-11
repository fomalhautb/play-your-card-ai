/**
 * 「现在跑的是不是本地开发」这一个判断，单独一份。
 *
 * 判据是 `.dev.vars` 里那一行 `DEV=1`——那个文件**只有 `wrangler dev` 会读**，
 * `wrangler deploy` 不会把它带上去（密钥走 `wrangler secret put`，普通变量走
 * `wrangler.jsonc` 的 `vars`，两处都没有 DEV）。所以线上这个值必然是 undefined，
 * 判断因此只有「有没有值」这一条，不必再对某个特定的字符串。
 * 测试里由 vitest.config.ts 的 miniflare bindings 给一份（测试就是开发环境）。
 *
 * 放在 src 根下而不是塞进 room/ 或 auth/：账号那半边（跨源放宽、Steam 票据收不收假的）
 * 和房间那半边（`room:error malformed` 发不发）都要用它，
 * 塞进任何一边都会让另一边反向依赖过去。
 */
export function isDevEnv(env: Env): boolean {
  return env.DEV !== undefined && env.DEV !== '' && env.DEV !== '0'
}
