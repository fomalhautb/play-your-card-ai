/**
 * 演出编排层的快照测试（《正式版架构》6.5 第 1 条）：
 * 假时钟喂 golden 那几局的事件流，输出的演出指令序列逐条比对。
 *
 * 两个座位各喂一遍：同一局对两个人来说演的东西完全不同（我方出牌是从手牌飞过去，
 * 对方出牌是强制展示），只测一边等于只测一半。
 *
 * **红了不等于错了**，和 core 的回放测试一个道理：改了时长、改了顺序本来就会让快照变。
 * 先逐条看差异是不是这次改动的预期结果，确认之后再 `pnpm --filter @ai-duel/canvas test -u`。
 * 看不懂差异就别更新——更新会把这次回归测试关掉。
 */

import type { PlayerId } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import { formatCues, makeDirector } from './helpers/directorFixtures'
import { batchesOf, loadGoldenGames } from './helpers/replayGolden'

/**
 * 每批事件之后把时钟推多久。
 *
 * 取够长：一批演出最长的一条是回合结算层（读题 4 秒 + 逐卡作答 + 盖章 + 底栏），
 * 一整轮下来十几秒。推不够的话下一批事件会插在上一批还没演完的时候，
 * 那测的就是「事件挤在一起」而不是「正常节奏」——挤在一起的情况另有单元测试专门测。
 */
const IDLE_MS = 60_000

const SEATS: PlayerId[] = [0, 1]

describe('golden 回放的演出指令序列', () => {
  const games = loadGoldenGames()

  it('golden 目录不是空的', () => {
    // 路径写错时 readdir 会给一个空数组，下面那一圈 it 一条都不会生成，
    // 测试报告看着全绿其实一局都没跑。
    expect(games.length).toBeGreaterThan(0)
  })

  for (const game of games) {
    for (const seat of SEATS) {
      it(`${game.name} · ${seat} 号座位`, () => {
        const director = makeDirector(seat)
        const batches = batchesOf(game, seat)
        const lines: string[] = []
        batches.forEach((batch, index) => {
          director.push(batch)
          director.advance(IDLE_MS)
          const cues = director.drain()
          if (cues.length === 0) return
          // 标上是第几批，快照红了能对回是哪一条指令引起的。
          lines.push(`--- 第 ${index} 批（${batch.events.length} 条事件） ---`)
          lines.push(formatCues(cues))
        })
        expect(lines.join('\n')).toMatchSnapshot()
      })
    }
  }
})
