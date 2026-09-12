/**
 * 冒烟用例跑起来之前要就位的两样东西：卡面图集，和壳自己的构建产物。
 *
 * 两样都不进仓库（`dist/` 和 `apps/web/public/` 都在 .gitignore 里），
 * 刚 clone 完的仓库、以及每一个新开的工作树里一个都没有。
 * 少了哪一样，失败信息都指不到点子上：没图集是首页那道等图的闸门一直不放行
 *（用例只会说「等画布超时」），没产物是主进程一起来就抛。
 *
 * 图集那一步和组件目录页、端到端那两份是同一个办法（`pnpm assets:build`），
 * 但**不 import 它们那一份**：跨包只走包入口，而那是 `packages/client` 的内部文件。
 * 两处各自 spawn 同一条命令，没有依赖关系。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// `__dirname` 而不是 `import.meta.url`，理由见 e2e/playwright.config.ts。
const HERE = __dirname
/** 仓库根：本文件在 apps/steam/e2e 下，往上三层。 */
const REPO_ROOT = resolve(HERE, '../../..')
/** 图集是一次全出的，有第一页就有整套（和 client 那份同一个口径）。 */
const ATLAS_MARKER = resolve(REPO_ROOT, 'apps/web/public/atlas/models-0.webp.json')
/** 主进程和渲染进程各一个标记，缺哪个都要重打一遍。 */
const MAIN_MARKER = resolve(HERE, '../dist/main/main.js')
const RENDERER_MARKER = resolve(HERE, '../dist/renderer/index.html')

export default function globalSetup(): void {
  if (!existsSync(ATLAS_MARKER)) {
    console.log(`没找到卡面图集（${ATLAS_MARKER}），先跑一遍 pnpm assets:build`)
    execFileSync('pnpm', ['assets:build'], { cwd: REPO_ROOT, stdio: 'inherit' })
  }
  if (existsSync(MAIN_MARKER) && existsSync(RENDERER_MARKER)) return
  console.log('壳还没构建，先跑一遍 pnpm --filter @ai-duel/steam build')
  execFileSync('pnpm', ['--filter', '@ai-duel/steam', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}
