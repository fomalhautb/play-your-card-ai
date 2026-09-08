/**
 * 跑截图回归之前先确认卡面图集在位，不在就现打一份。Playwright 的 globalSetup 调它。
 *
 * 图集是 `pnpm assets:build` 的产物，落在 `apps/web/public/atlas/`，进了 .gitignore，
 * 所以刚 clone 完的仓库里没有它。少了这一步，画布条目全都会显示「图集还没打」那句提示，
 * 于是每一张基线图都对不上——而报错只会说「图变了」，看不出是缺资源。
 *
 * 判在位只看第一页的清单文件：图集是一次全出的，有第一页就有整套。
 * 原画改了要重打是手动的事，这里不负责跟踪原画有没有变（和 bench 那边同一个口径）。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../..')
const MARKER = resolve(REPO_ROOT, 'apps/web/public/atlas/models-0.webp.json')

export default function ensureAtlas(): void {
  if (existsSync(MARKER)) return
  console.log(`没找到卡面图集（${MARKER}），先跑一遍 pnpm assets:build`)
  execFileSync('pnpm', ['assets:build'], { cwd: REPO_ROOT, stdio: 'inherit' })
}
