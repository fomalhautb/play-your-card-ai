/**
 * 点选目标的交互测试（《正式版架构》6.6 第 2 条、迁移第 19 条）。
 *
 * 技能牌的出牌是两步的：先把牌拖进落区，**不发指令**，先进选目标态；
 * 点中一个合法目标才发 `PLAY_CARD{targetInstanceId}`。这里测的就是这两步之间的那段状态——
 * 它是整个输入层唯一有状态的地方，也是最容易在改锁、改阶段时被漏掉的地方。
 *
 * 合法目标名单本身归 `skillTargets.ts`（纯函数），这里只确认「名单亮出来了、点名单里的
 * 才算数」。组件替身和版式见 helpers/fakeDuelInput.ts。
 */

import { describe, expect, it } from 'vitest'
import { CASTING_DIM } from '../src/components/TargetingLayer'
import { createDuelInput, type DuelInput } from '../src/scenes/duel/input'
import {
  asSprite,
  asTile,
  createInputProbe,
  fakeTile,
  fakeView,
  type InputProbe,
  openLocks,
} from './helpers/fakeDuelInput'

const IN_HAND: [number, number] = [700, 760]
const IN_ZONE: [number, number] = [700, 400]

/** 拖一张手牌进落区松手。技能牌走到这一步只会进选目标态，不发指令。 */
function dragToZone(input: DuelInput, probe: InputProbe, instanceId: string): void {
  const card = probe.card(instanceId)
  input.pressAt(asSprite(card), IN_HAND[0], IN_HAND[1])
  input.moveTo(IN_ZONE[0], IN_ZONE[1])
  input.releaseAt(IN_ZONE[0], IN_ZONE[1])
}

/** 一局：手上一张打对面的技能牌、一张 AI 牌；对面场上两个单位。 */
function boardCase(): { probe: InputProbe; input: DuelInput } {
  const probe = createInputProbe(
    fakeView({
      hand: [
        ['h1', 'hit-foe'],
        ['h2', 'ai'],
      ],
      foeBoard: [
        ['u1', 'ai'],
        ['u2', 'ai'],
      ],
    }),
  )
  return { probe, input: createDuelInput(probe.ctx) }
}

/** 一局：手上一张模型蒸馏、两张 AI 牌。它打的是**自己手里**的一张 AI 牌。 */
function handCase(): { probe: InputProbe; input: DuelInput } {
  const probe = createInputProbe(
    fakeView({
      hand: [
        ['h1', 'distill'],
        ['h2', 'ai'],
        ['h3', 'ai'],
      ],
    }),
  )
  return { probe, input: createDuelInput(probe.ctx) }
}

describe('技能牌选战场目标', () => {
  it('拖进落区先进选目标态，不发指令', () => {
    const { probe, input } = boardCase()
    dragToZone(input, probe, 'h1')
    expect(probe.commands).toEqual([])
    expect(probe.actions).toEqual([{ kind: 'targeting-begin' }])
    expect(probe.calls).toContain('targeting.begin(打对面)')
    expect(probe.calls).toContain('board.highlightTargets(u1,u2)')
  })

  it('点亮着的那一格，发出带目标的 PLAY_CARD', () => {
    const { probe, input } = boardCase()
    const tile = fakeTile('u2')
    input.bindTile(asTile(tile))
    dragToZone(input, probe, 'h1')
    tile.tap()
    expect(probe.commands).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: 'h1', targetInstanceId: 'u2' },
    ])
    // 选目标层和战场高亮都要收掉，不然打完还压着一层暗。
    expect(probe.calls).toContain('targeting.end')
    expect(probe.calls).toContain('board.clearTargets')
  })

  it('点没亮的那一格什么都不发，也不会退出选目标', () => {
    const { probe, input } = boardCase()
    // 己方场上那一格不在「打对面」的名单里。
    const mine = fakeTile('mine')
    input.bindTile(asTile(mine))
    dragToZone(input, probe, 'h1')
    mine.tap()
    expect(probe.commands).toEqual([])
    expect(probe.calls).not.toContain('targeting.end')
  })

  it('选目标期间点一格不再是放大查看', () => {
    const { probe, input } = boardCase()
    const mine = fakeTile('mine')
    input.bindTile(asTile(mine))
    dragToZone(input, probe, 'h1')
    mine.tap()
    expect(probe.actions.some((one) => one.kind === 'inspect-open')).toBe(false)
  })

  it('点选目标层的空白处是取消', () => {
    const { probe, input } = boardCase()
    dragToZone(input, probe, 'h1')
    probe.tapTargetingLayer()
    expect(probe.commands).toEqual([])
    expect(probe.actions).toEqual([{ kind: 'targeting-begin' }, { kind: 'targeting-cancel' }])
    expect(probe.calls).toContain('board.clearTargets')
  })

  it('取消之后那一格又变回放大查看', () => {
    const { probe, input } = boardCase()
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))
    dragToZone(input, probe, 'h1')
    probe.tapTargetingLayer()
    tile.tap()
    expect(probe.commands).toEqual([])
    expect(probe.actions.at(-1)).toEqual({
      kind: 'inspect-open',
      source: 'tile',
      flipId: 'u1',
    })
  })

  it('没进选目标态时点空白处不会误发一次取消', () => {
    const { probe } = boardCase()
    probe.tapTargetingLayer()
    expect(probe.actions).toEqual([])
  })

  it('一个合法目标都没有的技能牌直接打出，不让玩家对着满屏暗色发呆', () => {
    const probe = createInputProbe(fakeView({ hand: [['h1', 'hit-foe']], foeBoard: [] }))
    const input = createDuelInput(probe.ctx)
    dragToZone(input, probe, 'h1')
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
    expect(probe.calls).not.toContain('targeting.begin(打对面)')
  })

  it('不带目标的技能牌照常一步打出', () => {
    const probe = createInputProbe(fakeView({ hand: [['h1', 'plain']] }))
    const input = createDuelInput(probe.ctx)
    dragToZone(input, probe, 'h1')
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })

  it('选目标期间 actionsLocked 不挡点目标', () => {
    const { probe, input } = boardCase()
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))
    input.refresh(openLocks(), false)
    dragToZone(input, probe, 'h1')
    // 编排层在「玩家开始选目标」那一刻就把手牌冻上了（见 director/locks.ts），
    // 这一下要是被锁挡住，玩家就会卡在一屏亮着的格子上谁都点不动。
    input.refresh(openLocks({ actionsLocked: true }), false)
    tile.tap()
    expect(probe.commands).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: 'h1', targetInstanceId: 'u1' },
    ])
  })

  it('进答题阶段时正在选的目标被收掉', () => {
    const { probe, input } = boardCase()
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))
    dragToZone(input, probe, 'h1')
    // 战场马上就被答题那层盖住了，留着选目标态只会让玩家点到看不见的东西。
    input.refresh(openLocks({ quizWait: true }), false)
    expect(probe.calls).toContain('targeting.end')
    tile.tap()
    expect(probe.commands).toEqual([])
  })

  it('cancelTargeting 收得掉（换档位、换一局时场景会调它）', () => {
    const { probe, input } = boardCase()
    dragToZone(input, probe, 'h1')
    input.cancelTargeting()
    expect(probe.calls).toContain('targeting.end')
    // 这条路不发 targeting-cancel：不是玩家点的，编排层那边没有等着被撤销的操作。
    expect(probe.actions).toEqual([{ kind: 'targeting-begin' }])
  })
})

describe('技能牌选手牌目标', () => {
  it('候选手牌亮着，其余压暗', () => {
    const { probe, input } = handCase()
    dragToZone(input, probe, 'h1')
    expect(probe.commands).toEqual([])
    // 拖出去的那张自己不在扇形里了，剩下两张都是 AI 牌，所以都是候选。
    expect(probe.card('h2').alpha).toBe(1)
    expect(probe.card('h3').alpha).toBe(1)
  })

  it('不是 AI 牌的那些被压暗，点了也没反应', () => {
    const probe = createInputProbe(
      fakeView({
        hand: [
          ['h1', 'distill'],
          ['h2', 'ai'],
          ['h3', 'plain'],
        ],
      }),
    )
    const input = createDuelInput(probe.ctx)
    dragToZone(input, probe, 'h1')
    expect(probe.card('h2').alpha).toBe(1)
    expect(probe.card('h3').alpha).toBe(CASTING_DIM)
    // 压暗的那张点下去（一次轻点）不该被当成目标，也不该被当成「打出这张」。
    input.pressAt(asSprite(probe.card('h3')), IN_HAND[0], IN_HAND[1])
    input.releaseAt(IN_HAND[0], IN_HAND[1])
    expect(probe.commands).toEqual([])
  })

  it('点一张候选手牌，发出带手牌目标的 PLAY_CARD，并把压暗还原', () => {
    const { probe, input } = handCase()
    dragToZone(input, probe, 'h1')
    input.pressAt(asSprite(probe.card('h2')), IN_HAND[0], IN_HAND[1])
    input.releaseAt(IN_HAND[0], IN_HAND[1])
    expect(probe.commands).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: 'h1', targetInstanceId: 'h2' },
    ])
    expect(probe.card('h3').alpha).toBe(1)
  })

  it('打向手牌的那一档不亮任何格子', () => {
    const probe = createInputProbe(
      fakeView({
        hand: [
          ['h1', 'distill'],
          ['h2', 'ai'],
        ],
        foeBoard: [['u1', 'ai']],
      }),
    )
    const input = createDuelInput(probe.ctx)
    dragToZone(input, probe, 'h1')
    expect(probe.calls.some((one) => one.startsWith('board.highlightTargets'))).toBe(false)
  })

  it('选目标期间 actionsLocked 不挡点候选手牌', () => {
    const { probe, input } = handCase()
    input.refresh(openLocks(), false)
    dragToZone(input, probe, 'h1')
    // 手牌这条路要过 `canAct()`，而编排层这时候已经把手牌冻上了——
    // `canAct` 里那句 `|| targeting !== null` 就是专为这一下留的。
    input.refresh(openLocks({ actionsLocked: true }), false)
    input.pressAt(asSprite(probe.card('h2')), IN_HAND[0], IN_HAND[1])
    input.releaseAt(IN_HAND[0], IN_HAND[1])
    expect(probe.commands).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: 'h1', targetInstanceId: 'h2' },
    ])
  })

  it('手上没有第二张 AI 牌时不进选目标态，直接打出', () => {
    const probe = createInputProbe(fakeView({ hand: [['h1', 'distill']] }))
    const input = createDuelInput(probe.ctx)
    dragToZone(input, probe, 'h1')
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })
})
