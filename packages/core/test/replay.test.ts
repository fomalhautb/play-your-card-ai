/**
 * 回放测试（《正式版架构》6.3 最后一条）：把 test/golden/ 里录好的几局按指令重放一遍，
 * 每一步的事件流必须和 golden 逐字节相同。
 *
 * 这是规则引擎的"总账"：单元测试盯的是某一条规则，属性测试盯的是不变量，
 * 而这里盯的是"整局打下来每一条事件的每一个字段还是不是原来那样"——
 * 客户端照事件播动画、联机照事件同步，事件流悄悄变了这两处都会跟着变。
 *
 * **红了不等于错了。** 规则改动本来就会让事件流变，流程见 test/README.md：
 * 先看差异是不是这次改动的预期结果，人工确认之后再重录。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/index'
import { execute } from '../src/index'
import { startGame } from './helpers/gameSetup'
import { contentHashFor, GOLDEN_CONFIGS, type GoldenGame } from './helpers/goldenGames'
import { firstDifference } from './helpers/jsonDiff'

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'golden')

/** 重录的命令，好几处报错信息都要提到它。 */
const RERECORD = 'pnpm --filter @ai-duel/core golden:record'

function loadGolden(name: string): GoldenGame {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, `${name}.json`), 'utf8')) as GoldenGame
}

describe('回放 golden', () => {
  it('golden 目录里的文件和 GOLDEN_CONFIGS 一一对应', () => {
    // 加了一局没录、或者改名之后旧文件留在目录里，都会让"回放全绿"变得不可信。
    const onDisk = readdirSync(GOLDEN_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
    const configured = GOLDEN_CONFIGS.map((c) => c.name).sort()
    expect(onDisk, `golden 目录和配置对不上，跑一次 ${RERECORD}`).toEqual(configured)
  })

  for (const config of GOLDEN_CONFIGS) {
    it(`${config.name}：重放的事件流和 golden 逐字节相同`, () => {
      const golden = loadGolden(config.name)

      // 先对内容哈希：卡表费用、题目文案、预生成回答变了同样会让事件流变，
      // 但那是内容改动不是规则改动，报错要先把这一层分开，免得有人去引擎里找不存在的 bug。
      const hash = contentHashFor(golden.setup.questionIds)
      expect(
        hash,
        `内容数据变了（卡表的规则字段 / 题目 / 预生成回答），不是规则变了。` +
          `确认这次内容改动之后重录：${RERECORD}`,
      ).toBe(golden.contentHash)

      const started = startGame(golden.setup)
      const openingDiff = firstDifference(golden.initialEvents, started.events)
      expect(
        openingDiff,
        `开局事件流和 golden 不一致：${openingDiff}。` +
          `确认是有意的规则改动之后重录：${RERECORD}`,
      ).toBeNull()

      let state: GameState = started.state
      golden.steps.forEach((step, index) => {
        const result = execute(state, step.command)
        const diff = firstDifference(step.events, result.events)
        if (diff !== null) {
          throw new Error(
            `${config.name} 第 ${index} 步的事件流和 golden 不一致\n` +
              `  指令：${JSON.stringify(step.command)}\n` +
              `  差异：events${diff}\n` +
              `  这一步 golden 有 ${step.events.length} 条事件，重放出来 ${result.events.length} 条。\n` +
              `  规则改动请人工确认后 ${RERECORD} 重录。`,
          )
        }
        state = result.state
      })

      // 走完全部指令必须正好打完一局：少一条指令会停在半路，多一条会被拒。
      expect(
        state.phase,
        `重放完 golden 的指令之后没到终局，规则改动请人工确认后 ${RERECORD} 重录`,
      ).toBe('finished')
      expect(state.winner).not.toBeNull()
    })
  }
})
