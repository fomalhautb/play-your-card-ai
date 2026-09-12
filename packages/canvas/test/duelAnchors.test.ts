/**
 * 对局场景的语义锚点：名字 → 屏幕上的一块地方（src/scenes/duel/anchors.ts）。
 *
 * 这是新手教程唯一能问场景的问题，所以值得单独测两件事：
 * **答不上来的时候真的返回 null**（引导层照它跳过那个目标，而不是圈一个零面积的点），
 * 以及**战场那两排按版式算**（空场时那一排一个子节点都没有，量节点只会得到一个点）。
 *
 * 零件用替身而不是真组件：真组件要渲染器、要烤纹理、要 GPU，而这一层是纯换算——
 * 它只问零件两句话「你在不在场」和「你占哪一块」。真组件摆出来长什么样是截图回归的活。
 */

import { describe, expect, it } from 'vitest'
import type { AnchorRect } from '../src/scenes/anchors'
import { anchorRectOf, handCardRectOf } from '../src/scenes/duel/anchors'
import type { DuelContext } from '../src/scenes/duel/context'
import { desktopLayout } from '../src/scenes/duel/layout/desktopLayout'

/** 一个能报出自己占哪一块的假零件。`visible` 为假就等于「不在场」。 */
function node(box: AnchorRect | null, visible = true) {
  return { visible, getBounds: () => box ?? { x: 0, y: 0, width: 0, height: 0 } }
}

const BOX: AnchorRect = { x: 100, y: 200, width: 180, height: 60 }

interface Stub {
  /** 结算层立着没有。 */
  settleVisible?: boolean
  /** 结算层底栏那颗「确认」建出来没有（`enableConfirm` 之后才有）。 */
  settleConfirm?: boolean
  /** 手牌那排量不量得出来（一张牌都没有时量出来是零面积）。 */
  handBox?: AnchorRect | null
  /** 桌面档才有侧栏；手机档整条折叠掉了。 */
  sideBar?: boolean
  /** 「结束出牌」在等对方出牌时让位给「催一催」，那时它是藏着的。 */
  endPlayVisible?: boolean
  /** 扇形里现在摆着哪几张牌（按实例 id）。 */
  hand?: string[]
}

/** 一份够 `anchorRectOf` 跑起来的最小上下文。视口按桌面档那一档给。 */
function context(stub: Stub = {}): DuelContext {
  const parts = {
    endPlay: node(BOX, stub.endPlayVisible ?? true),
    panels: { mine: { tokenRail: node(BOX) } },
    sideBar: stub.sideBar === false ? null : { nextPlaque: node(BOX) },
    topBar: { centerArea: node(BOX) },
    fan: {
      ...node(stub.handBox === undefined ? BOX : stub.handBox),
      all: () => (stub.hand ?? []).map((instanceId) => ({ instanceId, ...node(BOX) })),
    },
    settle: {
      visible: stub.settleVisible ?? false,
      confirmButton: stub.settleConfirm === true ? node(BOX) : null,
    },
  }
  return { parts, layout: desktopLayout(1280, 900) } as unknown as DuelContext
}

describe('量得出来的那几处', () => {
  it('按钮、比分、Token 细条、「下一题」纸匾都按节点量', () => {
    const ctx = context()
    for (const name of [
      'endTurnButton',
      'scoreBoard',
      'tokenCounter',
      'questionCategoryPanel',
    ] as const) {
      expect(anchorRectOf(ctx, name), name).toEqual(BOX)
    }
  })

  // 战场那两排上下各一半，中线画在整块的正中（见 components/BoardGrid.ts 的 layout）。
  it('战场两排按版式算，不按节点量', () => {
    const ctx = context()
    const { board } = ctx.layout
    const foe = anchorRectOf(ctx, 'battlefieldFoe')
    const mine = anchorRectOf(ctx, 'battlefieldMine')
    expect(foe).toEqual({ x: board.x, y: board.y, width: board.width, height: board.height / 2 })
    expect(mine?.y).toBe(board.y + board.height / 2)
    expect(mine?.height).toBe(board.height / 2)
  })
})

describe('答不上来就返回 null', () => {
  it('手机档没有侧栏，「下一题」纸匾整个答不上来', () => {
    expect(anchorRectOf(context({ sideBar: false }), 'questionCategoryPanel')).toBeNull()
  })

  it('「结束出牌」让位给「催一催」时藏着，那一刻不报位置', () => {
    expect(anchorRectOf(context({ endPlayVisible: false }), 'endTurnButton')).toBeNull()
  })

  // 一张牌都没有时手牌容器是条零高的基线，量出来是个点。
  it('手上一张牌都没有时不报位置', () => {
    expect(anchorRectOf(context({ handBox: null }), 'hand')).toBeNull()
  })

  it('手上没有这张牌时也不报位置', () => {
    expect(handCardRectOf(context({ hand: ['h1'] }), 'not-in-hand')).toBeNull()
    expect(handCardRectOf(context({ hand: ['h1'] }), 'h1')).toEqual(BOX)
  })
})

/**
 * 结算层那颗「确认」。
 *
 * 它是端到端替玩家点掉每一轮确认时唯一的落点（见 client 的 e2e/tutorial.spec.ts），
 * 所以「什么时候有、什么时候没有」要钉死：结算层没立着、或者演出还没走到「按钮淡入」
 * 那一拍，都得是 null——报一个位置出去，用例就会去点一个此刻不存在的东西。
 */
describe('结算层那颗「确认」', () => {
  it('结算层没立着时答不上来', () => {
    expect(
      anchorRectOf(context({ settleVisible: false, settleConfirm: true }), 'settleConfirm'),
    ).toBeNull()
  })

  it('立着但按钮还没出场时也答不上来', () => {
    expect(anchorRectOf(context({ settleVisible: true }), 'settleConfirm')).toBeNull()
  })

  it('立着而且按钮出场了才报位置', () => {
    const rect = anchorRectOf(
      context({ settleVisible: true, settleConfirm: true }),
      'settleConfirm',
    )
    expect(rect).toEqual(BOX)
  })
})
