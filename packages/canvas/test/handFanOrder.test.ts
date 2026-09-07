/**
 * 扇形手牌的层级顺序：拖起来再放回去之后，牌要回到它原来那一层。
 *
 * 这条对应踩过的一个坑：拖拽把牌挪到了拖拽层，放回来时用 addChild 就是追加到末尾，
 * 而 Pixi 按子节点顺序画，于是这张牌永远压在整排之上（中间那张压住右邻居，一眼就是错的）。
 * 修法和理由见 HandFan.adoptInOrder。
 *
 * 只测能脱离 WebGL 的那一半：容器的父子关系和顺序是纯场景图，不用渲染器。
 * 卡牌本身要纹理和文字光栅化，所以这里拿 Container 当替身——扇形只用到它的
 * position / rotation / scale / alpha 和 cardId，替身够用。
 */

import { Container } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import type { CardSprite } from '../src/components/CardSprite'
import { HandFan } from '../src/components/HandFan'
import { PLAYER_FAN } from '../src/layout/fanMath'
import type { Animator } from '../src/runtime/animator'

/** 桌面档下一排手牌大致能铺开的宽度。这几条测的是顺序，具体摆哪不影响结论。 */
const WIDE = 1400

/**
 * 补间在这里全部落空。
 *
 * 顺序由 addChild / addChildAt 当场决定，和补间没关系；而真 Animator 要 GSAP 的时间轴，
 * 引进来只会让测试依赖一套和结论无关的东西。
 */
const noopAnimator = { tween: () => undefined } as unknown as Animator

function makeCard(id: string): CardSprite {
  const card = new Container()
  // 扇形认牌只看 cardId，替身补上这一个字段就能进出扇形。
  return Object.assign(card, { cardId: id }) as unknown as CardSprite
}

function makeFan(count: number): { fan: HandFan; cards: CardSprite[] } {
  const fan = new HandFan({ animator: noopAnimator, geometry: PLAYER_FAN, areaWidth: WIDE })
  const cards = Array.from({ length: count }, (_, i) => makeCard(`c${i}`))
  // 发牌是从牌库起飞的，起点姿态给什么都行——这里只关心它被放进了哪一层。
  for (const card of cards) fan.insert(card, null)
  return { fan, cards }
}

/** 扇形容器此刻的子节点顺序，用牌的 id 表示。 */
function order(fan: HandFan): string[] {
  return fan.children.map((child) => (child as unknown as CardSprite).cardId)
}

describe('HandFan：拖起再放回后的层级', () => {
  it('发进来就是左到右的顺序，右边的画在后面', () => {
    const { fan } = makeFan(5)
    expect(order(fan)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  })

  it('拖走再放回，插回原来那一位而不是压在最上面', () => {
    const { fan, cards } = makeFan(5)
    const dragLayer = new Container()
    const dragged = cards[1]!

    // 起拖：摘出排布，挪到拖拽层去画。
    fan.detach(dragged)
    dragLayer.addChild(dragged)
    expect(order(fan)).toEqual(['c0', 'c2', 'c3', 'c4'])

    // 松手没出牌，牌回扇形。
    fan.adoptInOrder(dragged)
    fan.returnToFan(dragged)
    expect(order(fan)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  })

  it('最左和最右那张也一样回到原位', () => {
    for (const index of [0, 4]) {
      const { fan, cards } = makeFan(5)
      const dragLayer = new Container()
      const dragged = cards[index]!
      fan.detach(dragged)
      dragLayer.addChild(dragged)
      fan.adoptInOrder(dragged)
      expect(order(fan)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
    }
  })

  it('另一张牌正飞向战场时，回来的牌数的是"还挂在扇形上"的那几张', () => {
    const { fan, cards } = makeFan(5)
    const dragLayer = new Container()
    const boardLayer = new Container()

    // c0 已经打出去了：它离开了扇形容器，也从手牌里除名。
    boardLayer.addChild(cards[0]!)
    fan.remove(cards[0]!)
    // c1 还在半空飞（挪走了容器，但这一刻还没从手牌里除名）。
    fan.detach(cards[1]!)
    dragLayer.addChild(cards[1]!)
    // c3 被玩家拖起来又放回去。
    fan.detach(cards[3]!)
    dragLayer.addChild(cards[3]!)
    expect(order(fan)).toEqual(['c2', 'c4'])

    fan.adoptInOrder(cards[3]!)
    expect(order(fan)).toEqual(['c2', 'c3', 'c4'])
  })

  it('hover 抬起再收回不动层级', () => {
    const { fan } = makeFan(5)
    fan.setHover(2)
    expect(order(fan)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
    fan.setHover(-1)
    expect(order(fan)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  })
})
