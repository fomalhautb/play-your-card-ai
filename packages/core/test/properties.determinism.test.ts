/**
 * fast-check 属性测试的确定性那一半：同 seed 同结果，以及状态 JSON 往返之后什么都没丢。
 *
 * 这两条守的是 docs/architecture.md 第 3 节那两句约定——
 * 「同样的 state + 同样的 command 永远得到同样的结果」和「GameState 必须全程可 JSON 序列化」。
 * 联机就靠它们成立：房主广播完快照，客人手上那份状态重放出来的画面必须和房主一模一样。
 *
 * 不变量那一半（费用、手牌账、非法指令、实例 id、终局条件）在 properties.test.ts。
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/index'
import { execute } from '../src/index'
import { playRandomGame } from './helpers/randomPlay'

const SEED = fc.integer({ min: 1, max: 0x7fffffff })

/** 同 seed 那条只是把整局跑两遍，很便宜，跑得多些。 */
/**
 * 每条属性的超时。一条属性要打上千局，本机 4~6 秒，vitest 默认的 5 秒在整包并行、
 * CI 慢机器上都会被挤过线；这里放到 60 秒，只防死循环，不当性能门禁。
 */
const PROPERTY_TIMEOUT_MS = 60_000

const NUM_RUNS = 1000

/**
 * JSON 往返那条每一步都要把整份状态（含几十张卡的目录）序列化两遍，比别的条贵得多，
 * 所以局数少一档。步数是全覆盖的——每一局的每一步都查，不抽样。
 */
const ROUND_TRIP_RUNS = 60

/** 走一遍 JSON：这正是联机时状态过一趟网络的样子。 */
function roundTrip(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState
}

describe('属性测试：确定性与可序列化', () => {
  it(
    '同一个 seed 跑两遍，状态和事件流逐字节相同',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const first = playRandomGame(seed, { illegalRate: 0.25 })
          const second = playRandomGame(seed, { illegalRate: 0.25 })
          // 指令序列、每一步的事件、每一步之后的状态，三样都比，
          // 只比最终状态的话"中间分叉又合回来"这种情况会漏掉。
          expect(JSON.stringify(second.setup)).toBe(JSON.stringify(first.setup))
          expect(JSON.stringify(second.initialEvents)).toBe(JSON.stringify(first.initialEvents))
          expect(second.steps.length).toBe(first.steps.length)
          for (let i = 0; i < first.steps.length; i++) {
            const a = first.steps[i]!
            const b = second.steps[i]!
            if (JSON.stringify(a.command) !== JSON.stringify(b.command)) {
              throw new Error(`seed=${seed} 第 ${i} 步的指令不一样`)
            }
            if (JSON.stringify(a.events) !== JSON.stringify(b.events)) {
              throw new Error(`seed=${seed} 第 ${i} 步的事件流不一样`)
            }
            if (JSON.stringify(a.state) !== JSON.stringify(b.state)) {
              throw new Error(`seed=${seed} 第 ${i} 步之后的状态不一样`)
            }
          }
        }),
        { numRuns: NUM_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    '状态 JSON 往返后相等，往返后的状态执行同一条指令也得到同样的结果',
    () => {
      fc.assert(
        fc.property(SEED, (seed) => {
          const play = playRandomGame(seed, { illegalRate: 0.25 })
          let before = play.initialState
          play.steps.forEach((step, index) => {
            const revived = roundTrip(before)
            // 往返之后一个字段都不能少：混进函数、Map、Date 或者 undefined 值都会在这里露馅。
            if (JSON.stringify(revived) !== JSON.stringify(before)) {
              throw new Error(`seed=${seed} 第 ${index} 步之前的状态 JSON 往返后变了`)
            }
            // 往返回来的状态接着走同一条指令，结果也必须一模一样——
            // 这一条才真正说明"没丢东西"：往返只是长得一样，接着算下去也一样才算数。
            const replayed = execute(revived, step.command)
            if (JSON.stringify(replayed.events) !== JSON.stringify(step.events)) {
              throw new Error(`seed=${seed} 第 ${index} 步：往返后的状态产生了不同的事件流`)
            }
            if (JSON.stringify(replayed.state) !== JSON.stringify(step.state)) {
              throw new Error(`seed=${seed} 第 ${index} 步：往返后的状态推进出了不同的新状态`)
            }
            before = step.state
          })
        }),
        { numRuns: ROUND_TRIP_RUNS },
      )
    },
    PROPERTY_TIMEOUT_MS,
  )
})
