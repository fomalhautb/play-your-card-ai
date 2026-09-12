/**
 * 答题阶段：揭晓题面、结算这一轮的对错和得分。
 *
 * 边界在「算完分就收手」：submitAnswers 把分写进快照后停在 settle，
 * 补牌、换先手、Token 补满、判终局全都归 engineRound.ts 的 confirmRound。
 * 本轮那道题怎么取也放在这儿（currentQuestion），宣告新一轮的 announceRound 要用。
 */

import { clone, reject } from './engineUtils'
import type { ExecuteResult, GameEvent } from './events'
import type { AnswerResult, Question } from './question'
import type { GameState, RoundVerdict } from './state'

/** 进答题阶段：揭晓本轮题目全文（含正确答案）。 */
export function enterQuiz(state: GameState): GameEvent[] {
  state.phase = 'quiz'
  return [{ type: 'QUESTION_REVEALED', question: currentQuestion(state) }]
}

/**
 * 结算本轮答题：判对错、罚下答错的、算出这一轮谁拿分，然后停在 settle 等双方确认。
 *
 * results 由房主/本地 driver 在进入答题阶段后一次性生成，覆盖场上每一个 AI；
 * 对不上就整条拒绝——那说明 driver 拿的是过期状态，宁可什么都不做也别结算出错的局面。
 *
 * 这里**不**推进轮次也不判终局：那一段在 engineRound.ts 的 confirmRound。
 * 结算界面要播一整套揭晓动画，中途局面不能变（补牌、换先手、Token 补满都会让界面跳），
 * 所以这条指令只把分算完写进快照就收手。
 */
export function submitAnswers(state: GameState, results: AnswerResult[]): ExecuteResult {
  const next = clone(state)
  const onBoard = new Set(
    [...next.players[0].board, ...next.players[1].board].map((a) => a.instanceId),
  )
  // 用 delete 的返回值一次挡掉三种情况：混进不在场的、重复提交同一个、漏掉在场的
  // （前两种当场为 false，第三种靠数量相等推出来）。
  if (results.length !== onBoard.size) return reject(state, '答题结果与场上 AI 不符')
  for (const result of results) {
    if (!onBoard.delete(result.instanceId)) return reject(state, '答题结果与场上 AI 不符')
  }

  const events: GameEvent[] = []
  // 本轮先数双方各有几个 AI 答对，第一判据直接比较这个数量。
  // 初值 0 顺带覆盖了"场上一个 AI 都没有"的一方：它一条结果都没有，自然是答对 0 个。
  // 只认答题结果、不看罚完之后场上还剩谁：被保送的单位答错也留在场上（见下面那条分支），
  // 照场上还有没有人来判就会把它算成答对了。
  const correctCounts: [number, number] = [0, 0]
  for (const result of results) {
    // 上面刚校验过 results 和场上一一对应，所以这里必定找得到人。
    const owner = next.players.find((p) => p.board.some((a) => a.instanceId === result.instanceId))!
    if (result.correct) correctCounts[owner.id] += 1
    const index = owner.board.findIndex((a) => a.instanceId === result.instanceId)
    const ai = owner.board[index]!
    events.push({
      type: 'AI_ANSWERED',
      instanceId: ai.instanceId,
      owner: ai.owner,
      // 这个 AI 马上可能被罚下，从快照里消失；界面画头像要的卡面身份只剩事件里这一份。
      cardId: ai.cardId,
      correct: result.correct,
      answer: result.answer,
      reasoning: result.reasoning,
    })
    // 答对的原地留场，只有答错的才要处理去留。
    if (!result.correct) {
      if (ai.safePassed === true) {
        // 「保送」：答错也不罚下，但这一题仍然算他答错（计分口径不变）。
        // 这条占的就是本该发 AI_ELIMINATED 的位置，客户端照着改演出。
        events.push({ type: 'AI_SAFE_PASSED', instanceId: ai.instanceId, owner: ai.owner })
      } else {
        owner.board.splice(index, 1)
        owner.discard.push({
          instanceId: ai.instanceId,
          cardId: ai.cardId,
          owner: ai.owner,
        })
        events.push({ type: 'AI_ELIMINATED', instanceId: ai.instanceId, owner: ai.owner })
      }
    }
  }

  // 计分：每轮就 1 分，按三档判（见 RoundVerdict）。
  // 场上一个 AI 都没有的一方答对数是 0，但对局照常走下去。
  const spent: [number, number] = [next.players[0].spentThisRound, next.players[1].spentThisRound]
  let gains: [number, number]
  let verdict: RoundVerdict
  if (correctCounts[0] !== correctCounts[1]) {
    verdict = 'more-correct'
    gains = correctCounts[0] > correctCounts[1] ? [1, 0] : [0, 1]
  } else if (spent[0] !== spent[1]) {
    // 只有答对数相同，才比本轮为新牌花掉的 Token，严格少的一方拿这一分。
    // 场上留着的老 AI 这一轮不重复付费，所以"什么都不打"是消耗 0 的合法打法。
    verdict = 'fewer-tokens'
    gains = spent[0] < spent[1] ? [1, 0] : [0, 1]
  } else {
    // 连消耗都一样：不设赢家，双方各拿 1 分（分差不变，所以才可能同时到线要加赛）。
    verdict = 'equal-tokens'
    gains = [1, 1]
  }
  next.players[0].score += gains[0]
  next.players[1].score += gains[1]
  const scores: [number, number] = [next.players[0].score, next.players[1].score]
  events.push({ type: 'ROUND_SCORED', gains, scores, correctCounts, spent, verdict })

  // 停在这里等双方点"进入下一轮"。轮次、Token、手牌全都保持本轮的样子，
  // 结算界面读快照就能显示"本轮消耗"这类只在这一刻有意义的数。
  next.phase = 'settle'
  next.settleConfirmed = [false, false]
  return { state: next, events }
}

/**
 * 本轮的题。
 * round 由引擎自己推进且永远不超过 totalRounds，取不到只可能是外部塞了一份坏状态，
 * 属于数据错误而不是玩家操作能触发的情况，所以直接抛错而不是回 COMMAND_REJECTED。
 */
export function currentQuestion(state: GameState): Question {
  const question = state.questions[state.round - 1]
  if (!question) throw new Error(`第 ${state.round} 轮没有对应的题目`)
  return question
}
