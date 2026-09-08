/**
 * 跑批前先确认卡面图集在位，不在就现打一份。Playwright 的 globalSetup 调它。
 *
 * 图集是构建产物（`pnpm assets:build` 打出来，落在 public/atlas/，进了 .gitignore），
 * 所以刚 clone 完的仓库里没有它。少了这一步，第一次跑批看到的是一串 404，
 * 而不是「图集还没打」——那种报错要翻半天才知道该跑哪条命令。
 *
 * 判在位只看第一页的清单文件：图集是一次全出的，有第一页就有整套。
 * 打过之后不重复打——原画改了要重打是手动的事，跑批不负责跟踪原画有没有变。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ATLAS } from '../scene/atlas'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 页面根就是 public/：DEFAULT_ATLAS 里的地址是相对它的绝对路径。 */
const PUBLIC_DIR = resolve(HERE, '../../public')
const REPO_ROOT = resolve(HERE, '../../../..')

export default function ensureAtlas(): void {
  const marker = resolve(PUBLIC_DIR, `.${DEFAULT_ATLAS.faces}`)
  if (existsSync(marker)) return
  console.log(`没找到卡面图集（${marker}），先跑一遍 pnpm assets:build`)
  execFileSync('pnpm', ['assets:build'], { cwd: REPO_ROOT, stdio: 'inherit' })
}
