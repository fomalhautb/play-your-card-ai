/**
 * 开包那条路的分流（`src/screens/packRoute.ts`）：赢了一局去不去开包、开的是哪张牌。
 *
 * 这两条是「一局打完之后玩家看到什么」的分岔点，而它们各自所在的组件一个要 driver、
 * 一个要 Pixi，所以逻辑抽成了纯函数在这里测。
 */

import { CARD_POOL } from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import { packCardOf, packPathOf } from '../src/screens/packRoute'

const SOME_CARD = CARD_POOL[0]!

describe('packPathOf', () => {
  it('抽到牌就给一个带卡 id 的地址', () => {
    expect(packPathOf(SOME_CARD)).toBe(`/pack?card=${SOME_CARD}`)
  })

  it('没抽到就是 null——结算页照这个决定摆不摆「开卡包」', () => {
    expect(packPathOf(null)).toBeNull()
  })
})

describe('packCardOf', () => {
  it('读得出地址里那张牌', () => {
    expect(packCardOf(`?card=${SOME_CARD}`)).toBe(SOME_CARD)
    // wouter 的 useSearch 给的是不带问号的那一截，两种都要认。
    expect(packCardOf(`card=${SOME_CARD}`)).toBe(SOME_CARD)
  })

  it('卡池里没有的一律当没有：地址是玩家能改的', () => {
    expect(packCardOf('?card=不存在的牌')).toBeNull()
    expect(packCardOf('?card=')).toBeNull()
    expect(packCardOf('')).toBeNull()
    // 原型链上的名字也不算——白名单是 Set，天然挡住这一类。
    expect(packCardOf('?card=toString')).toBeNull()
  })

  it('地址里还带着别的参数也照样读得出来', () => {
    expect(packCardOf(`?from=match&card=${SOME_CARD}`)).toBe(SOME_CARD)
  })

  it('两半接得上：`packPathOf` 造出来的地址，`packCardOf` 读回同一张牌', () => {
    for (const card of CARD_POOL) {
      const path = packPathOf(card)
      expect(path).not.toBeNull()
      expect(packCardOf(path!.slice(path!.indexOf('?')))).toBe(card)
    }
  })
})
