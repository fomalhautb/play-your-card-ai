/**
 * 卡池里的每一张牌都查得到贴图，而且贴图名就是它的 id。
 *
 * 这条约定（「id 即文件名」）是场景不带任何映射表的前提：加一张牌只要把原画放进去，
 * 渲染器一个字都不用改。它在 `content` 那边有一条对着文件系统查的测试（test/assets.test.ts），
 * 这里查的是另一半——渲染器**按这条约定去取**，而不是自己另发明一套名字。
 *
 * 用真卡池（`createCatalog()`）跑：造一份假卡池等于把卡表抄一遍，
 * 而这条测试要问的正是「真卡池里那几十张牌有没有漏的」。测试不受依赖方向那条规则管
 *（.dependency-cruiser.cjs 只扫 src），所以这里 import content 是可以的。
 */

import { createCatalog } from '@ai-duel/content'
import { Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { createCardVisuals, faceNameOf } from '../src/scenes/duel/cardVisuals'

const CATALOG = createCatalog()
const CARD_IDS = Object.keys(CATALOG.cards)

/** 假装图集里每张牌都有一帧。纹理内容无所谓——这里查的是「按什么名字去取」。 */
function texturesFor(ids: readonly string[]) {
  const faces: Record<string, Texture> = {}
  for (const id of ids) faces[id] = Texture.EMPTY
  return { faces, back: Texture.EMPTY }
}

describe('卡池 → 卡面展示数据', () => {
  it('贴图名就是卡牌 id', () => {
    for (const id of CARD_IDS) expect(faceNameOf(id)).toBe(id)
  })

  it('图集齐全时，卡池每张牌都拿得到自己的那一帧', () => {
    const textures = texturesFor(CARD_IDS)
    const visuals = createCardVisuals(CATALOG, textures)
    expect(visuals.missing()).toEqual([])
    for (const id of CARD_IDS) {
      const visual = visuals.visualOf(id, `i-${id}`)
      expect(visual.face, `${id} 取到的不是它自己那一帧`).toBe(textures.faces[id])
      expect(visual.name).toBe(CATALOG.cards[id]?.name)
      expect(visual.cost).toBe(CATALOG.cards[id]?.tokenCost)
      // 扇形和战场按这个 id 认牌，所以它必须是**实例** id 而不是卡牌 id：
      // 手上两张同名的牌否则会互相顶掉。
      expect(visual.id).toBe(`i-${id}`)
    }
  })

  it('缺帧的那几张报得出来，而且不会把整局拖崩', () => {
    const partial = CARD_IDS.slice(1)
    const textures = texturesFor(partial)
    const visuals = createCardVisuals(CATALOG, textures)
    expect(visuals.missing()).toEqual([CARD_IDS[0]])
    // 缺帧的退回牌背当正面：对局中途因为少一张贴图整局崩掉，比一张牌画错严重得多。
    expect(visuals.visualOf(CARD_IDS[0]!, 'x').face).toBe(textures.back)
  })
})
