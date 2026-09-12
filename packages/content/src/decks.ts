/**
 * 牌组构筑规则：一副牌怎样才算合法。
 *
 * 单独一个文件而不是并进 cards.ts，是因为这两件事的读者不一样：cards.ts 是卡表，
 * 这里是「拿卡表拼出来的东西合不合规矩」，服务端只要后者，不该为了一个上限把整张卡表读一遍。
 *
 * 规则只有一份的理由：客户端构筑页放行的牌组会原样发给服务端开局，服务端要再查一遍
 * （联机消息不可信，见 server 的 membership.ts）。两边各写一份的话，客户端能编出来、
 * 服务端不让开局的牌组迟早会出现，而且是在玩家按下「开始」那一刻才发作。
 */

import type { CardId } from '@ai-duel/core'
import { DECK_SIZE } from './cards'
import { CARD_POOL } from './collection'

/**
 * 同名卡最多带几份。
 *
 * 3 是构筑手感定的：低于 3 就凑不出「一张关键牌抽得到」的牌组，高于 3 又会让 20 张的牌组
 * 退化成六七种卡的重复堆。引擎不认这条规矩（core 一张卡都不带），所以它只在这里和
 * 服务端的开局校验上生效。
 */
export const MAX_COPIES = 3

const POOL = new Set<CardId>(CARD_POOL)

/**
 * 这副牌能不能上桌：张数正好、每张不超份数上限、每张都在卡池里。
 *
 * 只查牌，不查英雄：英雄不进牌组，它那条「技能实装了没有」的校验在英雄表上（HEROES 的 comingSoon）。
 * 卡池而不是整张卡表：「即将上线」的技能牌和调不到模型的那两张 AI 画得出来但打不动
 * （见 collection.ts 的 CARD_POOL），放它们上桌等于让人带一副打不出效果的牌。
 */
export function isLegalDeck(cards: readonly CardId[]): boolean {
  if (cards.length !== DECK_SIZE) return false
  const copies = new Map<CardId, number>()
  for (const cardId of cards) {
    if (!POOL.has(cardId)) return false
    const used = (copies.get(cardId) ?? 0) + 1
    if (used > MAX_COPIES) return false
    copies.set(cardId, used)
  }
  return true
}
