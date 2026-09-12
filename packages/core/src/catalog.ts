/**
 * 从一局的内容目录（`GameState.catalog`）里查定义。
 *
 * 这几个函数是规则的一部分而不是数据的一部分：它们只认 `Catalog` 这个形状，
 * 不认识具体有哪些卡。数据在 `content` 包里，core 一张卡都不带（见 cards.ts 的 Catalog）。
 */

import type { AiCard, CardId, Catalog, HandCard, HeroCard, HeroId } from './cards'

/**
 * 取卡牌定义。
 * 查不到说明牌组或目录数据写错了（不是玩家操作能触发的情况），所以直接抛错而不是返回 undefined。
 * 玩家传得进来的 cardId（调试指令）要先自己查一次目录挡掉，别让这里抛的异常打断引擎。
 */
export function getCard(catalog: Catalog, cardId: CardId): HandCard {
  const card = catalog.cards[cardId]
  if (!card) throw new Error(`未知卡牌：${cardId}`)
  return card
}

/**
 * 取 AI 牌定义。
 * 查出技能牌说明有人把它当成了场上单位，同样是数据错误，抛错。
 */
export function getAiCard(catalog: Catalog, cardId: CardId): AiCard {
  const card = getCard(catalog, cardId)
  if (card.kind !== 'ai') throw new Error(`这不是一张 AI 牌：${cardId}`)
  return card
}

/**
 * 取英雄牌定义。
 * 查不到说明状态里的 heroId 写错了，和 getCard 一样直接抛错。
 */
export function getHero(catalog: Catalog, heroId: HeroId): HeroCard {
  const hero = catalog.heroes[heroId]
  if (!hero) throw new Error(`未知英雄：${heroId}`)
  return hero
}

/**
 * 这张 AI 牌升一级会变成谁。已经是最新的一代、或者根本没有同系列的其它代，都返回 null。
 *
 * 直接读卡面上的 `AiCard.evolvesTo`，不另外维护一张进化链表：
 * 「鸡犬升天」和英雄技能「精准检索」/「化繁为简」看的因此是同一份字段，
 * 两处不可能各自给出不同的下一代。
 */
export function upgradeTargetOf(catalog: Catalog, cardId: CardId): CardId | null {
  const card = catalog.cards[cardId]
  if (card?.kind !== 'ai') return null
  return card.evolvesTo ?? null
}

/**
 * 这张 AI 牌降一级会变成谁。已经是最早的一代、或者根本没有同系列的其它代，都返回 null。
 *
 * 反着找"谁的 evolvesTo 指着我"。目录里每张卡最多被一张卡指向（由 content 的测试守着），
 * 所以答案唯一；找不到就是链头或者压根不在任何链上。
 * 卡表就几十张，每次现扫一遍比多存一张反向表更不容易和数据脱节。
 */
export function downgradeTargetOf(catalog: Catalog, cardId: CardId): CardId | null {
  if (catalog.cards[cardId]?.kind !== 'ai') return null
  for (const card of Object.values(catalog.cards)) {
    if (card.kind === 'ai' && card.evolvesTo === cardId) return card.id
  }
  return null
}
