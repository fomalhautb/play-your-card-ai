/**
 * 卡池 + 卡牌 id → 一张卡的展示数据（`CardVisual`）。
 *
 * 贴图按「**id 即文件名**」查：卡面原画的文件名就是卡牌 id，图集里的帧名跟着文件名走，
 * 所以这里不需要任何映射表——`content` 那边有一条测试盯着这条约定（test/assets.test.ts）。
 * 加一张牌只要把原画放进去，这里一个字都不用改。
 *
 * 场景不管资源从哪来（架构第 2 节第 5 条），纹理由调用方加载好传进来。
 * 图集里没有的那张牌**不抛错**，退回牌背当正面：对局中途因为少一张贴图整局崩掉，
 * 比一张牌画错严重得多。哪些牌缺贴图由 `missing()` 报出来，调用方（开发页、bench）
 * 可以在起场景时就发现，而不是等到那张牌被抽到。
 */

import type { CardId, Catalog } from '@ai-duel/core'
import { tokens } from '@ai-duel/design'
import type { Texture } from 'pixi.js'
import type { CardVisual } from '../../components/CardSprite'
import type { CardTextures } from '../duelContract'

/** '#rrggbb' → 0xrrggbb。令牌是给 CSS 和 Pixi 的字符串，`CardVisual.accent` 要的是数。 */
function rgb(hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

/** 三类牌的标识色。费用圆章的盘底跟着它走，一眼看得出手上这张是 AI 还是技能。 */
const ACCENT = { ai: rgb(tokens.color.accent.ai), skill: rgb(tokens.color.accent.skill) } as const

/** 这张牌的贴图叫什么。就是它的 id——约定见文件头。 */
export function faceNameOf(cardId: CardId): string {
  return cardId
}

export interface CardVisuals {
  /**
   * 建一张牌的展示数据。
   *
   * @param instanceId 同一张牌可以同时有好几个实例（手牌里两张一样的、场上一张手里一张），
   *   而扇形和战场都按 `CardVisual.id` 认牌，所以这里用实例 id 当标识而不是卡牌 id。
   */
  visualOf(cardId: CardId, instanceId: string): CardVisual
  /** 卡池里缺贴图的那些牌，起场景时报一次就够。 */
  missing(): CardId[]
}

export function createCardVisuals(catalog: Catalog, textures: CardTextures): CardVisuals {
  const faceOf = (cardId: CardId): Texture => textures.faces[faceNameOf(cardId)] ?? textures.back

  return {
    visualOf(cardId, instanceId) {
      const card = catalog.cards[cardId]
      return {
        id: instanceId,
        // 查不到定义就把 id 印上去。这只会在目录和牌组对不上时发生，
        // 而那时候看得见「印着 id 的那张牌」远比看见一张空白卡好排查。
        name: card?.name ?? cardId,
        cost: card?.tokenCost ?? 0,
        face: faceOf(cardId),
        back: textures.back,
        accent: card?.kind === 'skill' ? ACCENT.skill : ACCENT.ai,
      }
    },

    missing() {
      return Object.keys(catalog.cards).filter(
        (cardId) => textures.faces[faceNameOf(cardId)] === undefined,
      )
    },
  }
}
