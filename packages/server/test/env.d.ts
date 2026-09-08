/**
 * 告诉 `cloudflare:test` 里那个 `env` 有哪些绑定。
 *
 * 不写这一句它是空对象，测试里 `env.MATCH_ROOM` 编译不过。
 * `Env` 是 worker-configuration.d.ts（生成的绑定）加 env.d.ts（手写的密钥）合起来那个。
 */
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
