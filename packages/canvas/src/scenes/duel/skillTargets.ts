/**
 * 一张技能牌现在能打谁：合法目标的纯函数。
 *
 * 规则抄自 core 的 `denyReason`（engine.ts），四档目标各一条。这里算的是**候选名单**，
 * 引擎那边算的是「这一下合不合法」——两处必须一致，但方向不同：
 * 界面要提前把能点的格子亮出来，引擎只在收到指令时判一次。
 * 不一致的后果是玩家点得亮却被拒，所以改引擎那边的判定时这里要跟着改。
 *
 * 纯函数，只读一份视图和一张卡定义，不用起画布就测得了。
 */

import type { HandCard, InstanceId, PlayerView } from '@ai-duel/core'

/** 这张技能牌要在哪儿选目标：战场上的一格，还是自己手里的一张牌。 */
export type TargetScope = 'board' | 'hand' | 'none'

export function targetScopeOf(card: HandCard): TargetScope {
  if (card.kind !== 'skill' || card.target === undefined) return 'none'
  return card.target === 'own-hand-ai' ? 'hand' : 'board'
}

/** 战场上哪几格现在点得动。不是战场目标的牌返回空数组。 */
export function boardTargetsOf(view: PlayerView, card: HandCard): InstanceId[] {
  if (card.kind !== 'skill' || card.target === undefined) return []
  switch (card.target) {
    // 对方场上一个还没被干扰过的 AI（复读机、黑白颠倒）。
    case 'foe-ai':
      return view.opponent.board
        .filter((ai) => ai.interference === undefined)
        .map((ai) => ai.instanceId)
    // 己方场上一个还没被保送的 AI（保送）。
    case 'own-ai':
      return view.self.board.filter((ai) => ai.safePassed !== true).map((ai) => ai.instanceId)
    // 己方场上一个身上带着干扰的 AI（玉净瓶）。
    case 'own-affected-ai':
      return view.self.board
        .filter((ai) => ai.interference !== undefined)
        .map((ai) => ai.instanceId)
    // 打的是自己手牌里的一张 AI 牌（模型蒸馏），战场上一格都不亮。
    case 'own-hand-ai':
      return []
  }
}

/** 自己手里哪几张现在点得动。只有「打向手牌」那一档有值。 */
export function handTargetsOf(view: PlayerView, card: HandCard): InstanceId[] {
  if (card.kind !== 'skill' || card.target !== 'own-hand-ai') return []
  return view.self.hand
    .filter((one) => one.cardId !== card.id && view.catalog.cards[one.cardId]?.kind === 'ai')
    .map((one) => one.instanceId)
}
