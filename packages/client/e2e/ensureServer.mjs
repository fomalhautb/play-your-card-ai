/**
 * 起 `wrangler dev` 之前要就位的两样本地产物：服务端的密钥文件和账号库的表。
 *
 * 两样都**不进仓库**，刚 clone 完的仓库（以及每一个新开的 worktree）里一个都没有。
 * 少了哪一样，失败信息都指不到点子上：没密钥是 better-auth 在 Worker 里抛一句看不懂的话，
 * 没建表是每条 SQL 都报 `no such table`，而外面看到的只有一句
 * 「Timed out waiting 60000ms from config.webServer」。
 *
 * ## 为什么是一个 `.mjs`，而且由 webServer 的命令行调用
 *
 * Playwright 的 `globalSetup` 钩子跑在 `webServer` **之后**，而这两样正是服务端
 * 一启动就要用的，放那儿来不及。所以它挂在服务端那条 `command` 的前半段
 *（见 e2e/playwright.config.ts）——那是整条链上唯一比 wrangler 更早的位置。
 *
 * 写成 `.mjs` 而不是 `.ts`：命令行里是 `node` 直接跑它，不经过 Playwright 的
 * TypeScript 转译。这个文件只有几十行、没有类型可言，不值得为它另搭一条转译。
 *
 * 卡面图集不在这里——那是浏览器要的，`globalSetup` 的时机够用（见 e2e/globalSetup.ts）。
 *
 * 两件事都是幂等的：文件已经有了就一个字都不动（里面可能是人自己配的），
 * 表已经建过的话 wrangler 自己会说「没有要应用的迁移」。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根：本文件在 packages/client/e2e 下，往上三层。 */
const REPO_ROOT = resolve(HERE, '../../..')
const DEV_VARS = resolve(REPO_ROOT, 'packages/server/.dev.vars')

/**
 * `wrangler dev` 要的那份本地密钥（见 packages/server/.dev.vars.example）。
 *
 * 没有就现生成一份：这个文件在 .gitignore 里，本机随便一串够长的随机数就行，
 * 而让每个跑端到端的人先手动 `openssl rand` 一次只会变成一条谁都会忘的前置步骤。
 */
function ensureDevVars() {
  if (existsSync(DEV_VARS)) return
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  console.log(`没找到 ${DEV_VARS}，现生成一份本地密钥`)
  // DEV=1 是「这是本地开发」的判据，服务端拿它放宽跨源检查（见 server 的 devMode.ts）。
  writeFileSync(DEV_VARS, `BETTER_AUTH_SECRET=${secret}\nDEV=1\n`, 'utf8')
}

/**
 * 账号库建表。它写的是 packages/server/.wrangler 下面那个本地 D1，
 * 和 `pnpm dev:server` 用的是同一个。
 */
function ensureAuthDb() {
  execFileSync('pnpm', ['--filter', '@ai-duel/server', 'db:local'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}

ensureDevVars()
ensureAuthDb()
