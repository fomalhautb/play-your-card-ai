/**
 * 答题阶段的自动驾驶，搬到服务端的版本（《正式版架构》5.3、迁移第 23 条）。
 *
 * `SUBMIT_ANSWERS` 不是玩家能点出来的指令，它代表「场上这批 AI 已经答完题了」，
 * 直接决定谁答对、谁得分——客户端能发就等于能宣布自己全对，
 * 所以它连解析层都过不去（`matchCommandSchema` 只认玩家那四种）。
 * 由服务端在进答题阶段之后隔一小会儿自己发。
 *
 * 旧版这一层在客户端（legacy-client 的 `match/quizAutopilot.ts`），用的是 `setTimeout`。
 * 搬过来之后定时器换成 Durable Object 的 alarm：房间对象在没有消息进出时会休眠，
 * 内存里的 `setTimeout` 醒来就没了，alarm 由运行时保管，休眠期间照样到点。
 *
 * 延时常量也跟着留在服务端，客户端不再知道它是多少：
 * 客户端要演的是「揭晓题目 + AI 作答中」那一段，它自己按演出时长算就行，
 * 和服务端什么时候交卷不需要对齐——早了少播一段，晚了多等一会儿，局面都不会卡住。
 */

import { scriptedAnswers } from '@ai-duel/content'
import type {
  AiInstance,
  AnswerResult,
  Command,
  GameEvent,
  GameState,
  Question,
} from '@ai-duel/core'
import { scheduleAlarm } from './alarms'
import type { RoomContext } from './state'

/** 进答题阶段之后等多久替 AI 交卷（毫秒）。数字沿用旧客户端的 `QUIZ_AUTOPILOT_DELAY_MS`。 */
const QUIZ_ANSWER_DELAY_MS = 2500

/**
 * 本轮这批 AI 分别答了什么。**换成对局中途真去调模型 API，只改这一个函数。**
 *
 * 现在查的是 content 里那份离线预生成的真实模型回答表（`scriptedAnswers`），
 * 纯函数、确定性：同一份局面算两遍结果一样，所以重放和排查都好办。
 * 密钥在服务端这件事就是为它准备的（《正式版架构》5.3）——真调模型之后
 * 指令形状和这层的时序都不用动，只是这里从查表变成发请求。
 */
function answersFor(question: Question, aiUnits: readonly AiInstance[]): AnswerResult[] {
  return scriptedAnswers(question, aiUnits)
}

/**
 * 这一批事件揭晓了题目就排一个 alarm。**在事件下发之前调用**，
 * 免得客户端已经看见题目了、服务端这边的定时器还没落盘。
 *
 * 认 `QUESTION_REVEALED` 而不是「phase 变成了 quiz」，是因为这条事件本来就只在
 * 进答题阶段那一刻发一次，天然就是旧版那个「非 quiz → quiz 的变化沿」，
 * 不用再自己记上一次的 phase。同一轮里再来一条（引擎不会这么干）也只是把时间改掉，
 * 排不出两份（见 alarms.ts）。
 */
export async function scheduleAnswers(
  room: RoomContext,
  events: readonly GameEvent[],
): Promise<void> {
  if (!events.some((event) => event.type === 'QUESTION_REVEALED')) return
  await scheduleAlarm(room.ctx, room.store, 'quiz', Date.now() + QUIZ_ANSWER_DELAY_MS)
}

/**
 * alarm 到点该发的那条 `SUBMIT_ANSWERS`；这会儿已经不该答题了就返回 null。
 *
 * 到点时必须**现读最新局面**再算，不能用排定时器那一刻的快照：这中间局面可能已经走开了
 * （房间收摊、对局还没开始、别的指令把这一轮推过去了），拿旧快照算出来的结果
 * 会和场上对不上，被引擎整条拒掉。
 *
 * 返回指令而不是就地执行，是为了不和 commands.ts 互相 import（会成环，lint 卡死）：
 * 「跑一条指令」那一步归 `runCommand`，这里只管算出该跑哪条。
 */
export function answerCommand(state: GameState | null): Command | null {
  if (state === null || state.phase !== 'quiz') return null
  const question = state.questions[state.round - 1]
  if (question === undefined) return null
  // 双方在场的 AI 合并成一批一起答题，顺序固定为「0 号玩家的场，然后 1 号玩家的场」。
  const aiUnits = [...state.players[0].board, ...state.players[1].board]
  return { type: 'SUBMIT_ANSWERS', results: answersFor(question, aiUnits) }
}
