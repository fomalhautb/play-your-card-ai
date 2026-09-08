import type { D1Migration } from 'cloudflare:test'
import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { AUTH_BASE } from './accounts'

/**
 * 只有测试环境才有的绑定，在 vitest.config.ts 的 miniflare 配置里给上。
 * 不写进 env.d.ts：那份是线上也算数的 `Env`，把测试脚手架混进去，
 * 以后源码里误用 `env.TEST_MIGRATIONS` 类型检查还会放行。
 */
interface TestBindings {
  TEST_MIGRATIONS: D1Migration[]
}

/**
 * 每个测试文件开跑前的准备：把账号库建起来，再让 better-auth 生成好签名密钥。
 *
 * 为什么非得放在 setup 文件里：`@cloudflare/vitest-pool-workers` 默认**每条用例跑完
 * 都会把存储回滚**（KV、D1、Durable Object 全算），只有 setup 文件和顶层 `beforeAll`
 * 写进去的东西留得住。建表和密钥必须是全文件共用的，所以只能在这一层写。
 *
 * 建表语句是 vitest.config.ts 在 Node 那一侧读好、当成 `TEST_MIGRATIONS` 绑定传进来的——
 * workerd 里没有文件系统，读不了 migrations/ 目录。
 */
await applyD1Migrations(env.AUTH_DB, (env as Cloudflare.Env & TestBindings).TEST_MIGRATIONS)

/**
 * 拿一次公钥集，顺带把那对密钥生出来。
 *
 * better-auth 是**用到才生成**密钥的：第一次有人来要 token 或者来拿公钥集时才写那一行。
 * 如果放着不管，第一条用例签的 token 会连着密钥一起被回滚掉，后面的用例拿着它验不过。
 * 在这儿先要一次，密钥就落在回滚不到的那一层，整个文件里签出来的 token 都验得过。
 */
const jwks = await SELF.fetch(`${AUTH_BASE}/jwks`)
if (!jwks.ok) throw new Error(`预生成签名密钥失败（${jwks.status}）：${await jwks.text()}`)
