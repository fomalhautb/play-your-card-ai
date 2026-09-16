/**
 * 拖拽出牌的交互测试（《正式版架构》6.6 第 2 条、迁移第 19 条）。
 *
 * 走的是 `input.ts` 留出来的合成入口 `pressAt / moveTo / releaseAt`——它们直接喂给
 * `HandPointer` 的状态机，和真指针走的是同一条路（真指针只是多了一层 Pixi 事件系统的坐标换算）。
 * 断言的是**场景最后发出了什么指令**：这一层的全部职责就是「玩家这一串动作等于哪条指令」。
 *
 * 组件都是替身，版式是真的（见 helpers/fakeDuelInput.ts）——落区坐标是判定的输入之一，
 * 拿假数字喂进去就等于在测一套现实里不存在的版式。
 * 阈值本身（走多远算拖、松手落在哪儿算打出）是 `dragRules.ts` 的纯函数，那一层有自己的测试；
 * 这里只挑「阈值两侧各一档」确认接线没错。
 *
 * 浏览器里的那一半（真的 `page.mouse`、真的命中测试、真的按钮）在 bench 的
 * `tests/interaction.spec.ts`，两边合起来才是 6.6 那条要求的全部。
 */

import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD } from '../src/interaction/dragRules'
import { createDuelInput, type DuelInput } from '../src/scenes/duel/input'
import {
  asSprite,
  asTile,
  createInputProbe,
  type FakeCard,
  fakeTile,
  fakeView,
  type InputProbe,
  openLocks,
} from './helpers/fakeDuelInput'

/** 手牌区里的一点：在落区下沿（772.25）之下，正是玩家按下手牌那一带。 */
const IN_HAND: [number, number] = [700, 860]
/** 落区里的一点（x 334…1644、y 156…772.25）。 */
const IN_ZONE: [number, number] = [700, 400]
/** 落区外的一点：x 小于 334，落在左侧栏上。 */
const OUT_OF_ZONE: [number, number] = [100, 400]

function setup(): { probe: InputProbe; input: DuelInput } {
  const probe = createInputProbe(
    fakeView({
      hand: [
        ['h1', 'ai'],
        ['h2', 'ai'],
      ],
    }),
  )
  return { probe, input: createDuelInput(probe.ctx) }
}

/** 完整走一次拖拽：按下 → 移动到落点 → 在落点松手。 */
function drag(
  input: DuelInput,
  card: FakeCard,
  from: [number, number],
  to: [number, number],
  pointerType = 'mouse',
): void {
  input.pressAt(asSprite(card), from[0], from[1], pointerType)
  input.moveTo(to[0], to[1])
  input.releaseAt(to[0], to[1])
}

describe('拖拽出牌', () => {
  it('拖进落区松手，发出这张牌的 PLAY_CARD', () => {
    const { probe, input } = setup()
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })

  it('先报 UserAction 再发指令，顺序不能反', () => {
    const { probe, input } = setup()
    const order: string[] = []
    const ctx = probe.ctx as unknown as {
      userAction: (a: unknown) => void
      command: (c: unknown) => void
    }
    const realAction = ctx.userAction
    const realCommand = ctx.command
    ctx.userAction = (action) => {
      order.push('action')
      realAction(action)
    }
    ctx.command = (command) => {
      order.push('command')
      realCommand(command)
    }
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    // 编排层要赶在事件回来之前把演出锁上，反过来的话指令的回包可能先到（见 input.ts 文件头）。
    expect(order).toEqual(['action', 'command'])
    expect(probe.actions).toEqual([{ kind: 'play-card', instanceId: 'h1' }])
  })

  it('拖到落区外松手不发指令，牌回扇形', () => {
    const { probe, input } = setup()
    drag(input, probe.card('h1'), IN_HAND, OUT_OF_ZONE)
    expect(probe.commands).toEqual([])
    expect(probe.calls).toContain('fan.returnToFan')
  })

  it('拖起来之后牌被摘出扇形、挪进拖拽层', () => {
    const { probe, input } = setup()
    const card = probe.card('h1')
    input.pressAt(asSprite(card), IN_HAND[0], IN_HAND[1])
    expect(probe.calls).not.toContain('fan.detach')
    input.moveTo(IN_ZONE[0], IN_ZONE[1])
    expect(probe.calls).toContain('fan.detach')
    expect(probe.calls).toContain('drag.addChild')
  })

  it('没走够阈值：鼠标按一下算轻点，照样打出', () => {
    const { probe, input } = setup()
    const card = probe.card('h1')
    // 差一点点到阈值，所以整场按下都不算拖；松手时指针还在手牌区里，落区判定压根用不上。
    input.pressAt(asSprite(card), IN_HAND[0], IN_HAND[1])
    input.moveTo(IN_HAND[0] + DRAG_THRESHOLD - 0.01, IN_HAND[1])
    input.releaseAt(IN_HAND[0] + DRAG_THRESHOLD - 0.01, IN_HAND[1])
    expect(probe.calls).not.toContain('fan.detach')
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })

  it('没走够阈值：触屏按一下只把牌抬起来，不出牌', () => {
    const { probe, input } = setup()
    const card = probe.card('h1')
    input.pressAt(asSprite(card), IN_HAND[0], IN_HAND[1], 'touch')
    input.releaseAt(IN_HAND[0], IN_HAND[1])
    // 手指划过屏幕太容易蹭出一次点击，而出牌不可撤销（见 handPointer.ts 的 handleUp）。
    expect(probe.commands).toEqual([])
    expect(probe.calls).toContain('fan.setHover')
  })

  it('触屏拖进落区照样出牌：方向锁只在有滚动区的页面上才开', () => {
    const { probe, input } = setup()
    // 手牌扇形底下没有竖向滚动区，`scrollGuard` 恒为 false，所以触屏和鼠标同一条阈值。
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE, 'touch')
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })

  it('指针停在战场格子下沿以下 30px 松手，仍然算打出', () => {
    const { probe, input } = setup()
    /*
     * 鼠标拖拽时牌不抬（`lift` 对 mouse 是 0），卡的原点又在底边中点，整张牌画在指针**上方**。
     * 所以玩家看到「牌盖住了我方那排格子」的时候，指针其实还在格子下沿底下一截。
     * 落点区的下沿必须把这一截让出来，否则那一下会被判成取消（2026-09-16 的「打不出牌」）。
     */
    const { board } = probe.ctx.layout
    const below: [number, number] = [board.x + board.width / 2, board.y + board.height + 30]
    drag(input, probe.card('h1'), IN_HAND, below)
    expect(probe.commands).toEqual([{ type: 'PLAY_CARD', player: 0, instanceId: 'h1' }])
  })

  it('手牌里查不到定义的那张打不出去', () => {
    const probe = createInputProbe(fakeView({ hand: [['h1', 'ai']] }))
    // 目录和牌组对不上时会走到这儿：宁可这张牌拖不动，也不能发一条引擎必拒的指令。
    ;(probe.ctx.handCardIds as Map<string, string>).clear()
    const input = createDuelInput(probe.ctx)
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    expect(probe.commands).toEqual([])
  })

  it('还没收到第一份视图时什么都不发', () => {
    const probe = createInputProbe(fakeView({ hand: [['h1', 'ai']] }))
    probe.ctx.view = null
    const input = createDuelInput(probe.ctx)
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    expect(probe.commands).toEqual([])
  })
})

describe('锁：这一刻许不许动', () => {
  it('actionsLocked 时按下就不起拖，松手也不发指令', () => {
    const { probe, input } = setup()
    input.refresh(openLocks({ actionsLocked: true }), false)
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    expect(probe.calls).not.toContain('fan.detach')
    expect(probe.commands).toEqual([])
  })

  it('演出锁（有 cue 正拿着锁）时同样不发指令', () => {
    const { probe, input } = setup()
    input.refresh(openLocks(), true)
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    expect(probe.commands).toEqual([])
  })

  it('拖到一半锁上了：松手按取消算，牌回扇形', () => {
    const { probe, input } = setup()
    input.refresh(openLocks(), false)
    const card = probe.card('h1')
    input.pressAt(asSprite(card), IN_HAND[0], IN_HAND[1])
    input.moveTo(IN_ZONE[0], IN_ZONE[1])
    input.refresh(openLocks({ actionsLocked: true }), false)
    input.releaseAt(IN_ZONE[0], IN_ZONE[1])
    expect(probe.commands).toEqual([])
    expect(probe.calls).toContain('fan.returnToFan')
  })

  it('actionsLocked 直接落到「结束出牌」按钮的灰态上', () => {
    const { probe, input } = setup()
    input.refresh(openLocks({ actionsLocked: true }), false)
    expect(probe.endPlayDisabled).toBe(true)
    input.refresh(openLocks(), false)
    expect(probe.endPlayDisabled).toBe(false)
  })

  it('演出锁也会把「结束出牌」按钮压灰', () => {
    const { probe, input } = setup()
    input.refresh(openLocks(), true)
    expect(probe.endPlayDisabled).toBe(true)
  })

  // 它按不动的时候整颗收起来，不是灰着占地方，所以这两条各守一个方向。
  it('等对方出牌时「结束出牌」整颗收起来', () => {
    const { probe, input } = setup()
    input.refresh(openLocks({ waitingForFoe: true }), false)
    expect(probe.endPlayVisible).toBe(false)
  })

  it('轮到自己出牌时它回来', () => {
    const { probe, input } = setup()
    input.refresh(openLocks({ waitingForFoe: false }), false)
    expect(probe.endPlayVisible).toBe(true)
  })
})

describe('选目标期间又拖了一张牌', () => {
  /** 手上一张要选战场目标的技能牌、一张普通 AI 牌；对面场上一个单位。 */
  function setupTargeting(): { probe: InputProbe; input: DuelInput } {
    const probe = createInputProbe(
      fakeView({
        hand: [
          ['h1', 'hit-foe'],
          ['h2', 'ai'],
        ],
        foeBoard: [['u1', 'ai']],
      }),
    )
    return { probe, input: createDuelInput(probe.ctx) }
  }

  it('第二张牌回到扇形，拖拽层不留东西', () => {
    const { probe, input } = setupTargeting()
    // 技能牌拖进落区只会立起选目标层，指令要等玩家点中一个目标才发。
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    expect(probe.calls).toContain('targeting.begin(打对面)')
    /*
     * 选目标期间手牌照样拖得动（`canAct` 故意放行），于是第二张牌能被拖到战场上松手。
     * 这一下不该被受理，但那张牌此刻挂在拖拽层上——拖拽层在 world 最顶层而且吃指针事件，
     * 忘在那儿的话底下的战场和手牌从此都点不动（2026-09-16 的「打不出牌」之一）。
     */
    drag(input, probe.card('h2'), IN_HAND, IN_ZONE)
    expect(probe.commands).toEqual([])
    expect(probe.onDragLayer()).toEqual([])
  })

  it('选目标本身不受影响，仍然等着玩家点格子', () => {
    const { probe, input } = setupTargeting()
    drag(input, probe.card('h1'), IN_HAND, IN_ZONE)
    drag(input, probe.card('h2'), IN_HAND, IN_ZONE)
    // 替玩家把他已经开始的一件事收掉太唐突：真要放弃有「点空白处取消」那条路。
    expect(probe.calls).not.toContain('targeting.end')
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))
    probe.tapTile(tile)
    expect(probe.commands).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: 'h1', targetInstanceId: 'u1' },
    ])
  })
})

describe('点战场格子', () => {
  it('平时点一格是放大查看，不发指令', () => {
    const { probe, input } = setup()
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))
    tile.tap()
    expect(probe.actions).toEqual([{ kind: 'inspect-open', source: 'tile', flipId: 'u1' }])
    expect(probe.commands).toEqual([])
  })

  it('绑过的格子才点得动', () => {
    const { probe } = setup()
    const tile = fakeTile('u1')
    tile.tap()
    expect(probe.actions).toEqual([])
  })
})
