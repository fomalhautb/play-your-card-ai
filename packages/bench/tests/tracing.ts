/**
 * 录 Chrome trace，再交给 scripts/frames.py 用 Perfetto 的 trace_processor 取帧数据。
 *
 * 为什么不在页面里自己计时：6.9 说得很直白——页面里量到的只是 JS 那一段，
 * 合成、光栅、上屏都不在里面。要看用户实际看到的帧，只能从浏览器自己的 trace 里取。
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CDPSession } from '@playwright/test'
import type { FramesReport } from '../src/node/trace'
import { parseFramesReport } from '../src/node/trace'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRAMES_SCRIPT = resolve(HERE, '../scripts/frames.py')

/**
 * 要录哪些类别。
 *
 * `pipeline` 是 PipelineReporter（每帧从 BeginFrame 到上屏）所在的类别，帧时间靠它；
 * `disabled-by-default-devtools.timeline` 提供 FunctionCall / EvaluateScript 这些切片，
 * 主线程脚本时间靠它们。其余几个是补充和兜底，换 Chrome 版本时哪个还在都有可能。
 * 别再往里加大类别（比如 disabled-by-default-cc.debug）：trace 会大到几百兆，解析比跑还慢。
 */
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing',
  'benchmark',
  'latency',
  'toplevel',
  'pipeline',
  'cc',
  'viz',
  'gpu',
  'v8',
  'v8.execute',
]

/** 录一段 trace，写到 path。body 里干的事全在这段 trace 里。 */
export async function captureTrace(
  client: CDPSession,
  path: string,
  body: () => Promise<void>,
): Promise<void> {
  await client.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      includedCategories: TRACE_CATEGORIES,
    },
  })
  await body()

  // tracingComplete 事件带着流句柄，必须在 Tracing.end 之前挂上监听，
  // 否则事件可能在我们订阅之前就到了。
  const completed = new Promise<string>((done) => {
    client.once('Tracing.tracingComplete', (event) => done((event as { stream: string }).stream))
  })
  await client.send('Tracing.end')
  const handle = await completed

  const parts: string[] = []
  for (;;) {
    const chunk = (await client.send('IO.read', { handle, size: 4 << 20 })) as {
      data: string
      base64Encoded?: boolean
      eof: boolean
    }
    parts.push(
      chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data,
    )
    if (chunk.eof) break
  }
  await client.send('IO.close', { handle })
  writeFileSync(path, parts.join(''), 'utf8')
}

export function traceScratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'ai-duel-bench-'))
}

/** uv 不在就没法解析 trace，整组时间指标直接跳过而不是给一堆 0。 */
export function hasUv(): boolean {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function extractFrames(tracePath: string, outPath: string, explain = false): FramesReport {
  const args = ['run', '--with', 'perfetto', 'python', FRAMES_SCRIPT, tracePath, '--out', outPath]
  if (explain) args.push('--explain')
  // stdout 让它直接打到终端：trace_processor 第一次跑会下一个可执行文件，
  // 那几十秒里有个进度条，藏起来会让人以为卡死了。
  execFileSync('uv', args, { stdio: ['ignore', 'inherit', 'inherit'] })
  return parseFramesReport(readFileSync(outPath, 'utf8'))
}
