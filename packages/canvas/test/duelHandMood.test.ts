/**
 * 手牌「现在能不能动」那一档外观的测试（正式版简化第 4 步之三，差异清单表 4 第 1~3 条）。
 *
 * 编排层早就在算 `handLockReason` / `handFrozen` 了，这一条盯的是**有人消费它**：
 * 整排下沉、逐张压暗、光标换成 not-allowed、点下去弹一句小字。
 * 没有断言的那一半（小字长什么样、沉多少像素）归目录页和关键帧截图管。
 *
 * 组件是替身、版式是真的，同 duelInput.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { createDuelInput, type DuelInput } from '../src/scenes/duel/input'
import {
  asSprite,
  createInputProbe,
  fakeView,
  type InputProbe,
  openLocks,
} from './helpers/fakeDuelInput'

/** 手牌区里的一点，和 duelInput.test.ts 同一处。 */
const IN_HAND: [number, number] = [700, 760]

function setup(tokens = 99): { probe: InputProbe; input: DuelInput } {
  const view = fakeView({
    hand: [
      ['h1', 'ai'],
      ['h2', 'ai'],
    ],
  })
  // 视图是只读的替身，改 Token 是为了摆出「买不起」那一档。
  ;(view.self as { tokens: number }).tokens = tokens
  const probe = createInputProbe(view)
  return { probe, input: createDuelInput(probe.ctx) }
}

/** 鼠标点一下某张手牌：按下、原地松手。 */
function tapCard(probe: InputProbe, input: DuelInput, instanceId: string): void {
  input.pressAt(asSprite(probe.card(instanceId)), ...IN_HAND)
  input.releaseAt(...IN_HAND)
}

describe('灰墨态', () => {
  it('整排锁着时下沉并压暗，光标仍是普通指针（这一档只是出不了牌，不是点不动）', () => {
    const { probe, input } = setup()
    input.refresh(openLocks({ handLockReason: 'foe-turn', waitingForFoe: true }), false)
    expect(probe.calls).toContain('fan.setSunk(true)')
    expect(probe.card('h1').dim).not.toBe(0xffffff)
    expect(probe.card('h1').cursor).toBe('pointer')
  })

  it('没锁也买得起时整排回到本色', () => {
    const { probe, input } = setup()
    input.refresh(openLocks({ handLockReason: 'foe-turn' }), false)
    input.refresh(openLocks(), false)
    expect(probe.calls).toContain('fan.setSunk(false)')
    expect(probe.card('h1').dim).toBe(0xffffff)
    expect(probe.card('h1').cursor).toBe('pointer')
  })

  it('Token 不够的那几张单独压得更暗，光标换成 not-allowed', () => {
    const locked = setup()
    locked.input.refresh(openLocks({ handLockReason: 'deal' }), false)

    const poor = setup(0)
    poor.input.refresh(openLocks(), false)
    expect(poor.probe.card('h1').cursor).toBe('not-allowed')
    // 买不起比整排锁着更暗：两件事的严重程度不一样，看上去也该不一样。
    expect(poor.probe.card('h1').dim).toBeLessThan(locked.probe.card('h1').dim)
    // 整排没锁，所以不下沉。
    expect(poor.probe.calls).toContain('fan.setSunk(false)')
  })
})

describe('点一张打不出的牌', () => {
  it('买不起时不发指令（只弹小字）', () => {
    const { probe, input } = setup(0)
    tapCard(probe, input, 'h1')
    expect(probe.commands).toEqual([])
  })

  it('买得起时照常打出', () => {
    const { probe, input } = setup()
    tapCard(probe, input, 'h1')
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })
})
