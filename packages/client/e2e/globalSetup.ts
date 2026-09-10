/**
 * 端到端跑起来之前要就位的三样东西：卡面图集、服务端的本地密钥、账号库的表。
 *
 * 三样都是**不进仓库的本地产物**，刚 clone 完的仓库里一个都没有。
 * 少了哪一样失败信息都指不到点子上：没图集是「画面上一张牌都没有」，
 * 没密钥是 better-auth 在 Worker 里抛一句看不懂的话，没建表是每条 SQL 都报 no such table。
 *
 * 图集那一份直接复用组件目录页的（它只认 apps/web/public/atlas），另外两样在这里补。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ensureAtlas from '../dev/storybook/ensureAtlas'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根：本文件在 packages/client/e2e 下，往上三层。 */
const REPO_ROOT = resolve(HERE, '../../..')
const SERVER_DIR = resolve(REPO_ROOT, 'packages/server')
const DEV_VARS = resolve(SERVER_DIR, '.dev.vars')

/**
 * `wrangler dev` 要的那份本地密钥（见 packages/server/.dev.vars.example）。
 *
 * 没有就现生成一份：这个文件在 .gitignore 里，本机随便一串够长的随机数就行，
 * 而让每个跑端到端的人先手动 `openssl rand` 一次只会变成一条谁都会忘的前置步骤。
 * 已经有了就一个字都不动——里面可能是人自己配的。
 */
function ensureDevVars(): void {
  if (existsSync(DEV_VARS)) return
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  console.log(`没找到 ${DEV_VARS}，现生成一份本地密钥`)
  // DEV=1 是「这是本地开发」的判据，服务端拿它放宽跨源检查（见 server 的 devMode.ts）。
  writeFileSync(DEV_VARS, `BETTER_AUTH_SECRET=${secret}\nDEV=1\n`, 'utf8')
}

/**
 * 账号库建表。已经建过的话 wrangler 自己会说「没有要应用的迁移」，所以每次都跑一遍最省心。
 * 它写的是 packages/server/.wrangler 下面那个本地 D1，和 `pnpm dev:server` 用的是同一个。
 */
function ensureAuthDb(): void {
  execFileSync('pnpm', ['--filter', '@ai-duel/server', 'db:local'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}

export default function globalSetup(): void {
  ensureAtlas()
  ensureDevVars()
  ensureAuthDb()
}
