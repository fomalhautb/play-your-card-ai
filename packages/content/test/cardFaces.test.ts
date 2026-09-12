import { describe, expect, it } from 'vitest'
import { CARD_FACES, CARDS, DEFAULT_COST_BADGE_CENTER } from '../src/index'
import { cardFaceTableSchema } from '../src/schema'

/**
 * 卡面展示配置（src/cardFaces.ts）。
 *
 * 这张表是照着原画一张张量出来的，量错了不会有任何东西报错——只是画面上颜色不对，
 * 或者圆章缺一块。所以这里替它守三件事：
 * 42 张卡一张不少、该有的颜色都有、每枚圆章整个都还在卡面上。
 *
 * 键和卡种这两条查的时候要拿卡表比对，而 schema 目录一向不 import 数据表，
 * 所以断言放在这里而不是 schema 里（理由见 src/schema/cardFace.ts）。
 */

/** 卡面的标称尺寸，和展示层画卡用的是同一组数（费用圆章的百分比就是照它换算的）。 */
const CARD_WIDTH = 150
const CARD_HEIGHT = 225

/** 圆章直径是卡宽的 20.8%，全场统一，所以半径是卡宽的 10.4%。 */
const BADGE_RADIUS = CARD_WIDTH * 0.104

/**
 * 圆章整枚都要落在卡面矩形里。
 *
 * 之所以专门查：好几张原画的星章本来就压着画框，而盖上去的圆章比星章大得多，
 * 照原样量出来的圆心会让圆章探出卡外（那几张的圆心因此往里收过，见数据旁的注释）。
 * 谁要是拿新量的原值把收过的那几张改回去，这条就会红。
 */
function expectBadgeInsideCard(center: { x: number; y: number }, label: string) {
  const cx = (CARD_WIDTH * center.x) / 100
  const cy = (CARD_HEIGHT * center.y) / 100
  expect(cx - BADGE_RADIUS, `${label} 左边探出卡外`).toBeGreaterThanOrEqual(0)
  expect(cy - BADGE_RADIUS, `${label} 上边探出卡外`).toBeGreaterThanOrEqual(0)
  expect(cx + BADGE_RADIUS, `${label} 右边探出卡外`).toBeLessThanOrEqual(CARD_WIDTH)
  expect(cy + BADGE_RADIUS, `${label} 下边探出卡外`).toBeLessThanOrEqual(CARD_HEIGHT)
}

describe('卡面展示配置', () => {
  it('整张表过 schema', () => {
    expect(() => cardFaceTableSchema.parse(CARD_FACES)).not.toThrow()
  })

  it('卡表里每张卡都配了卡面，也没有多出卡表里没有的键', () => {
    // 两边取集合比：漏一张的话那张卡到了画面上没有主色也没有圆章位置。
    expect(Object.keys(CARD_FACES).sort()).toEqual(Object.keys(CARDS).sort())
  })

  it('18 张 AI 牌都有插画主色，24 张技能牌都有原画采来的盘底色', () => {
    const aiIds = Object.values(CARDS)
      .filter((card) => card.kind === 'ai')
      .map((card) => card.id)
    const skillIds = Object.values(CARDS)
      .filter((card) => card.kind === 'skill')
      .map((card) => card.id)
    expect(aiIds).toHaveLength(18)
    expect(skillIds).toHaveLength(24)
    // AI 牌的费用章盘底由展示层拿 accent 掺出来，所以 accent 缺了连章都上不了色。
    for (const id of aiIds) expect(CARD_FACES[id]?.accent, id).toBeDefined()
    // 技能牌反过来：盘底色是采样值，算不出来，只能一张张给。
    for (const id of skillIds) expect(CARD_FACES[id]?.costFill, id).toBeDefined()
  })

  it('每张牌的费用圆章整枚都落在卡面里', () => {
    for (const [id, face] of Object.entries(CARD_FACES)) {
      expectBadgeInsideCard(face.costBadge ?? DEFAULT_COST_BADGE_CENTER, id)
    }
  })

  it('兜底圆心自己也落得进卡面', () => {
    // 20 张技能牌走的是这个值，上一条已经顺带查过；单列一条是为了让它改动时直接红在名字上。
    expectBadgeInsideCard(DEFAULT_COST_BADGE_CENTER, 'DEFAULT_COST_BADGE_CENTER')
  })
})
