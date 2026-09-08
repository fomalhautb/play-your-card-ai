/**
 * `Command` 的 schema 和 core 的类型对表，以及「哪些指令不许从网上进来」那条闸。
 *
 * 类型层面的双向钉子在 src/command.ts 末尾（core 加一种指令、schema 多一个字段都会编译报错），
 * 这里补的是编译期查不了的那半边：穷举表和实际的解析行为。
 */

import type { Command } from '@ai-duel/core'
import { describe, expect, it } from 'vitest'
import {
  commandSchema,
  debugCommandSchema,
  parseClientMessage,
  playerCommandSchema,
} from '../src/index'

/**
 * core 的 `test/engine.test.ts` 里出现过的每一种指令 type，一种一条合法样本。
 *
 * 这张表就是「穷举」本身：下面第一条测试拿它和 `commandSchema` 的分支列表对账，
 * 两边对不上（core 加了指令而这里没加、或者反过来）当场红。
 * 分类标注的是**联机时谁能发**，见 src/command.ts 的文件头。
 */
const COMMAND_SAMPLES: { command: Command; from: 'player' | 'server' | 'debug' }[] = [
  {
    from: 'player',
    command: { type: 'PLAY_CARD', player: 0, instanceId: 'p0-c3' },
  },
  {
    from: 'player',
    command: { type: 'PLAY_CARD', player: 1, instanceId: 'p1-c7', targetInstanceId: 'p0-c2' },
  },
  { from: 'player', command: { type: 'END_PLAY', player: 0 } },
  { from: 'player', command: { type: 'USE_HERO_SKILL', player: 1, targetInstanceId: 'p1-c4' } },
  { from: 'player', command: { type: 'CONFIRM_ROUND', player: 0 } },
  {
    from: 'server',
    command: {
      type: 'SUBMIT_ANSWERS',
      results: [{ instanceId: 'p0-c3', correct: true, answer: '会', reasoning: '因为它会。' }],
    },
  },
  { from: 'debug', command: { type: 'DEBUG_ADD_CARD', player: 0, cardId: 'gpt-4' } },
  { from: 'debug', command: { type: 'DEBUG_REMOVE_CARD', player: 1, instanceId: 'p1-c9' } },
  { from: 'debug', command: { type: 'DEBUG_PLAY_CARD', player: 0, instanceId: 'p0-c1' } },
  { from: 'debug', command: { type: 'DEBUG_SKIP_TO_QUIZ' } },
]

/** 上面那张表覆盖到的 type，去重。 */
const SAMPLED_TYPES = [...new Set(COMMAND_SAMPLES.map((s) => s.command.type))].sort()

describe('穷举表', () => {
  it('每种指令 type 都有 schema 分支，一种不多一种不少', () => {
    const branches = commandSchema.options.map((option) => option.shape.type.value).sort()
    expect(branches).toEqual(SAMPLED_TYPES)
  })

  it('九种指令，联机允许四种、服务端专属一种、调试四种', () => {
    const counts = { player: 0, server: 0, debug: 0 }
    for (const sample of COMMAND_SAMPLES) counts[sample.from] += 1
    // 样本表里 PLAY_CARD 有两条（带不带目标各一），所以按 type 去重之后才是九种。
    expect(SAMPLED_TYPES).toHaveLength(9)
    expect(counts).toEqual({ player: 5, server: 1, debug: 4 })
  })
})

describe('合法样本', () => {
  for (const { command } of COMMAND_SAMPLES) {
    it(`${command.type} 能解析，且 JSON 往返之后一模一样`, () => {
      const parsed = commandSchema.safeParse(JSON.parse(JSON.stringify(command)))
      expect(parsed.success).toBe(true)
      expect(parsed.data).toEqual(command)
    })
  }
})

describe('联机通道只收玩家那四种', () => {
  for (const { command, from } of COMMAND_SAMPLES) {
    const allowed = from === 'player'
    it(`${command.type} ${allowed ? '通过' : '被拒'}`, () => {
      expect(playerCommandSchema.safeParse(command).success).toBe(allowed)
    })
  }

  it('DEBUG 指令包在 match:command 里也进不来', () => {
    for (const { command, from } of COMMAND_SAMPLES) {
      if (from !== 'debug') continue
      const result = parseClientMessage({ type: 'match:command', command })
      expect(result.ok, command.type).toBe(false)
    }
  })

  it('SUBMIT_ANSWERS 包在 match:command 里也进不来——它由服务端的答题 autopilot 发', () => {
    const result = parseClientMessage({
      type: 'match:command',
      command: { type: 'SUBMIT_ANSWERS', results: [] },
    })
    expect(result.ok).toBe(false)
  })

  it('调试指令自己那条 schema 认得它们（单机 driver 要用）', () => {
    for (const { command, from } of COMMAND_SAMPLES) {
      expect(debugCommandSchema.safeParse(command).success, command.type).toBe(from === 'debug')
    }
  })
})

describe('畸形指令一律被拒，而且不抛', () => {
  const BAD: [string, unknown][] = [
    ['缺 player', { type: 'PLAY_CARD', instanceId: 'p0-c3' }],
    ['缺 instanceId', { type: 'PLAY_CARD', player: 0 }],
    ['player 是字符串', { type: 'PLAY_CARD', player: '0', instanceId: 'p0-c3' }],
    ['座位是负数', { type: 'END_PLAY', player: -1 }],
    ['座位是 2', { type: 'END_PLAY', player: 2 }],
    ['座位是小数', { type: 'END_PLAY', player: 0.5 }],
    ['instanceId 是空串', { type: 'PLAY_CARD', player: 0, instanceId: '' }],
    ['instanceId 超长', { type: 'PLAY_CARD', player: 0, instanceId: 'x'.repeat(65) }],
    ['多一个字段', { type: 'END_PLAY', player: 0, extra: 1 }],
    ['results 不是数组', { type: 'SUBMIT_ANSWERS', results: {} }],
    ['results 里少字段', { type: 'SUBMIT_ANSWERS', results: [{ instanceId: 'p0-c3' }] }],
    ['results 太长', { type: 'SUBMIT_ANSWERS', results: new Array(65).fill(null) }],
    ['没听说过的 type', { type: 'DROP_TABLE', player: 0 }],
    ['type 不是字符串', { type: 7 }],
    ['整个是 null', null],
    ['整个是数组', []],
    ['整个是字符串', 'PLAY_CARD'],
  ]

  for (const [name, input] of BAD) {
    it(name, () => {
      // safeParse 从不抛，所以这里真正要看的是「返回了 false」而不是「没炸」；
      // 万一将来换成会抛的写法，这条测试会以未捕获异常的形式失败，同样拦得住。
      expect(commandSchema.safeParse(input).success).toBe(false)
    })
  }
})
