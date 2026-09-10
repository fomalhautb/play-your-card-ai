/**
 * 把确定性那组每条用例算出的一行汇总成 results/ 下的报告。
 *
 * 为什么不在 spec 里用模块级数组收着、最后 afterAll 写一次：那一组是并行跑的，
 * 每个 worker 是独立进程，数组各存各的，afterAll 也各跑各的，
 * 于是每个 worker 都往同一个文件写一遍自己那几行，谁最后写谁说了算——
 * 报告里只会剩下一个 worker 跑过的那部分，其余的静悄悄消失。
 * reporter 跑在 Playwright 主进程，所有 worker 的用例结果都要经过它，
 * 是这里唯一天然能把 8 条用例汇到一处的位置。
 *
 * 用例把自己那行挂成 JSON 附件（名字见 ROW_ATTACHMENT），这里收下来排好序再写。
 */

import type { Reporter, TestResult } from '@playwright/test/reporter'
import { scenarioNames } from '../scenarios/index'
import { limitsFor, pendingLimits } from '../thresholds'
import { PROFILES } from './profiles'
import type { DeterministicRow } from './report'
import { renderDeterministicMarkdown } from './report'
import { writeResult } from './results'

/** 用例挂结果行时用的附件名，两边得对上。 */
export const ROW_ATTACHMENT = 'deterministic-row'

const profileOrder = PROFILES.map((p) => p.name)
const segmentOrder = scenarioNames()

/** 报告的行序固定成「按视口档、再按剧本」的声明顺序，不受并行下谁先跑完影响。 */
function rank(row: DeterministicRow): number {
  const profile = profileOrder.indexOf(row.profile as (typeof profileOrder)[number])
  const segment = segmentOrder.indexOf(row.segment)
  return (profile < 0 ? profileOrder.length : profile) * 1000 + (segment < 0 ? 999 : segment)
}

export default class DeterministicReporter implements Reporter {
  /** 按「视口/剧本」存，重试同一条用例时后一次覆盖前一次。 */
  private readonly rows = new Map<string, DeterministicRow>()

  onTestEnd(_test: unknown, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== ROW_ATTACHMENT) continue
      // 用 body 挂的附件不落盘，Playwright 原样带到主进程（见 normalizeAndSaveAttachment），
      // 所以这里只认 body；哪天改成用 path 挂，这里要跟着读文件。
      const raw = attachment.body?.toString('utf8')
      if (!raw) continue
      const row = JSON.parse(raw) as DeterministicRow
      this.rows.set(`${row.profile}/${row.segment}`, row)
    }
  }

  onEnd(): void {
    // 一行都没有说明这次跑的不是确定性那组（比如 --project=timing），
    // 这时候不能写：会把上一次的确定性报告清成空表。
    if (this.rows.size === 0) return
    const report = {
      generatedAt: new Date().toISOString(),
      rows: [...this.rows.values()].sort((a, b) => rank(a) - rank(b)),
      pending: pendingLimits(limitsFor('desktop')),
    }
    writeResult('deterministic.json', `${JSON.stringify(report, null, 2)}\n`)
    writeResult('deterministic.md', renderDeterministicMarkdown(report))
  }
}
