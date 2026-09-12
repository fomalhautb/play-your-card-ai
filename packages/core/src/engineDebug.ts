/**
 * dev 测试房专用的加牌 / 弃牌两条调试指令。
 *
 * 单独一份不是因为它们特殊，恰恰相反：它们走的是和正常指令一样的 execute 路径、
 * 一样的校验口径，摆开只是为了让「正经规则」那几份文件里不掺测试用的东西。
 *
 * 另外两条调试指令不在这儿，因为它们真的只是**绕开一条检查**、结算完全复用正经路径：
 * DEBUG_PLAY_CARD 走 enginePlay.ts 的 playCard（只免掉"轮到谁"），
 * DEBUG_SKIP_TO_QUIZ 走那边的 skipToQuiz。
 *
 * 谁能发这几条不归引擎管，是服务端的事（见 commands.ts 里那几条的注释）。
 */

import type { CardId, InstanceId } from './cards'
import { clone, drawCards, reject } from './engineUtils'
import type { ExecuteResult, GameEvent } from './events'
import type { CardInstance, GameState, PlayerId } from './state'

/**
 * 测试房：给某位玩家加一张手牌。
 *
 * 不带 cardId 就是正常从牌堆抽一张；带 cardId 则凭空造一张新实例塞进手牌，牌堆不动，
 * 这样想测某张卡不用先把牌组调成一水儿的那张卡。
 */
export function debugAddCard(state: GameState, playerId: PlayerId, cardId?: CardId): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const events: GameEvent[] = []

  if (cardId === undefined) {
    if (player.deck.length === 0) return reject(state, '牌堆已空')
    drawCards(player, 1, events)
    return { state: next, events }
  }

  // 这里直接查目录而不用 getCard：cardId 是客户端传来的，写错很正常，
  // 得退一条 COMMAND_REJECTED 回去，不能让 getCard 抛的异常把房主的引擎打断。
  if (!next.catalog.cards[cardId]) return reject(state, `未知卡牌：${cardId}`)
  const card: CardInstance = {
    // 凭空造的牌不属于任何一副牌组，用 dbg- 前缀跟发牌时的 p0-c3 这类 id 区分开。
    instanceId: `dbg-${next.seq++}`,
    cardId,
    owner: playerId,
  }
  player.hand.push(card)
  // 复用 CARD_DRAWN：对客户端来说"手上多了一张牌"要播的动画是一样的。
  events.push({ type: 'CARD_DRAWN', player: playerId, card })
  return { state: next, events }
}

/** 测试房：弃掉某位玩家的一张手牌，不填 instanceId 就弃最后一张。 */
export function debugRemoveCard(
  state: GameState,
  playerId: PlayerId,
  instanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  if (player.hand.length === 0) return reject(state, '手牌为空')

  const index =
    instanceId === undefined
      ? player.hand.length - 1
      : player.hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return reject(state, '手牌里没有这张卡')

  const removed = player.hand.splice(index, 1)[0]!
  player.discard.push(removed)
  return {
    state: next,
    events: [{ type: 'CARD_REMOVED', player: playerId, instanceId: removed.instanceId }],
  }
}
