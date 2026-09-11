/**
 * 回合的推进：结算界面双方确认之后，收场还是开下一轮。
 *
 * 和 engineQuiz.ts 的分界是「算分」与「推进」：分在答完题那一刻就算完写进快照了，
 * 这里只读快照来判要不要收场，然后才动轮次、先后手、Token 和手牌。
 * 分成两步是给结算界面留一段「局面不再变」的时间（理由见那边的 submitAnswers）。
 *
 * announceRound 也在这儿：开局和每轮换手都要宣告一次，两处走同一个函数事件序才一致。
 * 开局那一次由 engineSetup.ts 调过来——方向是单向的，这边不反过来 import 它。
 */

import { ROUND_DRAW_SIZE, TOKEN_MAX_GROWTH, WIN_TARGET } from './constants'
import { currentQuestion } from './engineQuiz'
import { clone, drawCards, other, reject } from './engineUtils'
import type { ExecuteResult, GameEvent } from './events'
import type { GameState, PlayerId } from './state'

/**
 * 某一方确认本轮结算。双方都确认了才真的推进：推进下一轮，或在最后一轮结束整局。
 *
 * 为什么要等两边：结算界面是一整套逐步揭晓的动画，两端各播各的、快慢不同步，
 * 先看完的一方直接把局面推走的话，另一边的动画会被下一轮的横幅和补牌打断。
 */
export function confirmRound(state: GameState, playerId: PlayerId): ExecuteResult {
  if (state.settleConfirmed[playerId]) return reject(state, '这一轮你已经确认过了')

  const next = clone(state)
  next.settleConfirmed[playerId] = true
  const events: GameEvent[] = [{ type: 'ROUND_CONFIRMED', player: playerId }]
  if (!next.settleConfirmed[0] || !next.settleConfirmed[1]) return { state: next, events }

  // 收场有两条路：有人**单独**到 WIN_TARGET 分（题库还剩题也当场结束），
  // 或者题库出完了保底判一次。双方同时到线且分数相同不算结束，继续加赛下一轮。
  // 分数在 engineQuiz.ts 的 submitAnswers 里就加完了，这里只是读快照来判要不要收场。
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  const decided = (scores[0] >= WIN_TARGET || scores[1] >= WIN_TARGET) && scores[0] !== scores[1]
  if (decided || next.round >= next.totalRounds) {
    next.phase = 'finished'
    // 'draw' 只可能来自"题库出完还同分"这一路：decided 那一路已经要求分数不相等。
    next.winner = scores[0] === scores[1] ? 'draw' : scores[0] > scores[1] ? 0 : 1
    events.push({ type: 'GAME_OVER', winner: next.winner })
    return { state: next, events }
  }

  next.round += 1
  next.firstPlayer = other(next.firstPlayer)
  next.activePlayer = next.firstPlayer
  next.phase = 'play'
  // 技能牌留下的"本轮"效果全部在这里失效：核电站的减费、金钟罩、场上单位身上的干扰和保送，
  // 连同小卡上那一列角标读的 affectedBy 一起清（那份是"本轮被哪几张牌打过"，见 state.ts）。
  // 清除点定在真的进下一轮这一步（而不是提交答题结果时），是因为结算界面还要照着这些标记
  // 演一遍"这个被干扰了 / 这个是被保送留下的"。玉净瓶卡面上「本轮作用于你的 Agent 的效果」
  // 那句口径也是靠这里成立的。
  // 第 2 轮起每轮开始双方各补牌，起手那 5 张之外的牌都是这么来的（张数见 ROUND_DRAW_SIZE）。
  // Token 同时补满并抬高上限：省下来的不跨轮累积，直接被新的满额盖掉
  //（模型蒸馏顶破上限的那部分也是在这里被覆盖的）。
  // 本轮消耗和"派过 AI 了"两个标志一起清零，新一轮从头算。
  // 消耗那一份的读者是结算界面，所以一直留到真的离开结算这一刻才失效。
  for (const player of next.players) {
    delete player.shielded
    player.costReduction = 0
    for (const ai of player.board) {
      delete ai.affectedBy
      delete ai.interference
      delete ai.safePassed
    }
    player.tokenMax += TOKEN_MAX_GROWTH
    player.tokens = player.tokenMax
    player.spentThisRound = 0
    drawCards(player, ROUND_DRAW_SIZE, events)
  }
  announceRound(next, events)
  return { state: next, events }
}

/** 宣告新一轮开始并让先手行动。开局和每轮换手都走这里，保证两处事件序一致。 */
export function announceRound(state: GameState, events: GameEvent[]): void {
  const question = currentQuestion(state)
  events.push({
    type: 'ROUND_STARTED',
    round: state.round,
    firstPlayer: state.firstPlayer,
    category: question.category,
    // 关键词拷一份出来：事件会被 JSON 深拷贝、联机时还要原样转发，
    // 直接引用题库那个数组的话，改事件等于改题库。
    keywords: question.keywords.slice(),
  })
  events.push({ type: 'PLAY_TURN_STARTED', player: state.firstPlayer })
}
