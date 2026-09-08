/**
 * 往 results/ 里写文件。
 *
 * 单独一个模块，是因为写结果的有两处、而且不在同一个进程里：
 * 时间指标在用例进程里写（tests/timing.spec.ts），确定性指标在 Playwright 主进程的
 * reporter 里写（deterministicReporter.ts，原因见那个文件）。
 * 路径按本文件的位置算，跟工作目录无关——Playwright 的 worker 和 reporter 的 cwd 不保证一致。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = resolve(HERE, '../../results')

export function writeResult(name: string, content: string): string {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const path = resolve(RESULTS_DIR, name)
  writeFileSync(path, content, 'utf8')
  return path
}
