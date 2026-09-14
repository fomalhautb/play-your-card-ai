/**
 * 卡池 + 卡牌 id → 一张卡的展示数据（`CardVisual`）。
 *
 * 贴图按「**id 即文件名**」查：卡面原画的文件名就是卡牌 id，图集里的帧名跟着文件名走，
 * 所以这里不需要任何映射表——`content` 那边有一条测试盯着这条约定（test/assets.test.ts）。
 * 加一张牌只要把原画放进去，这里一个字都不用改。
 *
 * 场景不管资源从哪来（架构第 2 节第 5 条），纹理由调用方加载好传进来。
 * **卡面的那点展示配置也一样**：费用圆章的圆心、盘底色、插画主色是内容数据，
 * 唯一出处在 `@ai-duel/content` 的 `CARD_FACES`，而 canvas 不许依赖 content
 *（依赖方向见《正式版架构》7.2），所以由装配层查好按 `faces` 传进来。不传就走兜底。
 *
 * 图集里没有的那张牌**不抛错**，退回牌背当正面、盖一层兜底文字层：对局中途因为少一张贴图
 * 整局崩掉，比一张牌画错严重得多。哪些牌缺贴图由 `missing()` 报出来，调用方（开发页、bench）
 * 可以在起场景时就发现，而不是等到那张牌被抽到。
 */

import type { CardId, Catalog } from '@ai-duel/core'
import { tokens } from '@ai-duel/design'
import type { CardVisual } from '../../components/CardSprite'
import { hexToInt, mix } from '../../fx/colors'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import type { CardFaceStyle, CardTextures } from '../duelContract'

/** 三类牌的标识色。兜底文字层底栏那行字跟着它走，一眼看得出是 AI 还是技能。 */
const ACCENT = {
  ai: hexToInt(tokens.color.accent.ai),
  skill: hexToInt(tokens.color.accent.skill),
} as const

/**
 * AI 牌费用圆章的盘底：插画主色调进纸面墨色。
 *
 * 式子抄黑客松 `cardFaceOverlay.css` 的
 * `background: color-mix(in srgb, var(--card-accent) 52%, var(--paper-ink))`。
 * 技能牌不走这条——它们的盘底是从原画那枚章上直接采的色（`CardFaceStyle.costFill`）。
 */
const AI_COST_ACCENT_RATIO = 0.52

/** 这张牌的贴图叫什么。就是它的 id——约定见文件头。 */
export function faceNameOf(cardId: CardId): string {
  return cardId
}

export interface CardVisuals {
  /**
   * 建一张牌的展示数据。
   *
   * @param instanceId 同一张牌可以同时有好几个实例（手牌里两张一样的、场上一张手里一张），
   *   而扇形和战场都按 `CardVisual.instanceId` 认牌，所以这里用实例 id 当标识而不是卡牌 id。
   */
  visualOf(cardId: CardId, instanceId: string): CardVisual
  /** 卡池里缺贴图的那些牌，起场景时报一次就够。 */
  missing(): CardId[]
}

export function createCardVisuals(
  catalog: Catalog,
  textures: CardTextures,
  faces: Record<string, CardFaceStyle> = {},
): CardVisuals {
  const paperInk = hexToInt(tokens.color.paper.ink)

  return {
    visualOf(cardId, instanceId) {
      const card = catalog.cards[cardId]
      const art = textures.faces[faceNameOf(cardId)]
      const style = faces[cardId]
      const skill = card?.kind === 'skill'
      /*
       * 技能牌翻过去是那张星象底图的背面（上面印卡名和说明），AI 牌是美术卡背。
       * 没给星象那张就退回同一张牌背——少一张贴图不该让技能牌翻不了面。
       */
      const back = (skill ? textures.skillBack : undefined) ?? textures.back
      return {
        instanceId,
        // 查不到定义就把 id 印上去。这只会在目录和牌组对不上时发生，
        // 而那时候看得见「印着 id 的那张牌」远比看见一张空白卡好排查。
        name: card?.name ?? cardId,
        cost: card?.tokenCost ?? 0,
        face: art ?? textures.back,
        back,
        accent: costFillOf(style, skill, paperInk),
        // 只有具名 AI 牌盖雕花匾：技能牌的原画已经把卡名和效果印进图里了。
        ...(card?.kind === 'ai' ? { skillName: card.skillName } : {}),
        ...(style?.costBadge === undefined ? {} : { costCenter: toPixels(style.costBadge) }),
        // 手牌里只有技能牌翻得过去，和黑客松一致（问号章只长在它们身上）。
        ...(skill ? { flippable: true } : {}),
        ...(art === undefined
          ? {
              body: {
                text: card?.text ?? '',
                kind: skill ? '技能' : 'AI',
                kindInk: skill ? ACCENT.skill : ACCENT.ai,
              },
            }
          : {}),
      }
    },

    missing() {
      return Object.keys(catalog.cards).filter(
        (cardId) => textures.faces[faceNameOf(cardId)] === undefined,
      )
    },
  }
}

/**
 * 费用圆章的盘底色。
 *
 * 三条路：技能牌用原画采下来的 `costFill`；AI 牌拿插画主色和纸面墨色调；
 * 两样都没有（目录页的样例卡、缺数据的牌）就退回卡种标识色，至少两类牌还分得开。
 */
function costFillOf(style: CardFaceStyle | undefined, skill: boolean, paperInk: number): number {
  if (style?.costFill !== undefined) return hexToInt(style.costFill)
  if (style?.accent !== undefined) {
    return mix(hexToInt(style.accent), AI_COST_ACCENT_RATIO, paperInk)
  }
  return skill ? ACCENT.skill : ACCENT.ai
}

/** 圆心从百分比换算成卡面基准尺寸下的像素（x 按卡宽、y 按卡高，原点在卡的左上角）。 */
function toPixels(center: { x: number; y: number }): { x: number; y: number } {
  return { x: (CARD_WIDTH * center.x) / 100, y: (CARD_HEIGHT * center.y) / 100 }
}
