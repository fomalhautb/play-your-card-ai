/**
 * 引擎的入口：`execute` 分派指令，另把各阶段模块的对外导出转发出去。
 *
 * 规则本身按阶段拆成了下面这几份，`execute` 之外的代码都在那里。
 * 顺序就是**分层顺序**，每一份只 import 排在它上面的，谁都不 import engine.ts：
 *
 * - constants.ts    可调的规则常量：起手张数、Token 上限、胜利分数
 * - engineUtils.ts  最底层的小工具：reject / clone / shuffle / withRng / drawCards / other
 * - engineQuiz.ts   答题阶段：enterQuiz / submitAnswers / currentQuestion
 * - engineSkills.ts 技能牌和英雄技能的结算：applySkillEffect / useHeroSkill
 * - engineRound.ts  回合的推进：confirmRound / announceRound
 * - engineSetup.ts  开局：createGame
 * - enginePlay.ts   出牌阶段：effectivePlayCost / playCard / denyReason / endPlay / skipToQuiz
 * - engineDebug.ts  测试房的加牌 / 弃牌指令
 *
 * 单向这条是**硬要求**，不是整洁癖：规则里本来就有几处横向调用——出牌结束要进答题
 *（enginePlay → engineQuiz）、开局要宣告第一轮（engineSetup → engineRound）、
 * 结算完下一轮又回到出牌阶段。反方向的调用一律不写，写了就是 import 环
 *（biome 的 noImportCycles 是 error）。真需要双向时，把共用的那一段往下沉到 engineUtils，
 * 或者提到这里的 `execute` 里来接。
 */

import type { Command } from './commands'
import { debugAddCard, debugRemoveCard } from './engineDebug'
import { endPlay, playCard, skipToQuiz } from './enginePlay'
import { submitAnswers } from './engineQuiz'
import { confirmRound } from './engineRound'
import { useHeroSkill } from './engineSkills'
import { reject } from './engineUtils'
import type { ExecuteResult } from './events'
import type { GameState } from './state'

// 对外的引擎接口一直是「从 @ai-duel/core import」，包外看不到上面这些文件怎么分，
// 所以各阶段的公开名字在这里统一转发一次。
export {
  ADA_TOKEN_MAX_BONUS,
  INITIAL_TOKEN_MAX,
  ROUND_DRAW_SIZE,
  STARTING_HAND_SIZE,
  TOKEN_MAX_GROWTH,
  WIN_TARGET,
} from './constants'
export { effectivePlayCost } from './enginePlay'
export { createGame, type GameSetup, type PlayerSetup } from './engineSetup'
export { other } from './engineUtils'

/**
 * 执行一条指令。
 *
 * 纯函数：不改传入的 state，返回新状态和本次产生的事件。
 * 指令非法时状态原样返回，只带一条 COMMAND_REJECTED。
 */
export function execute(state: GameState, command: Command): ExecuteResult {
  if (state.phase === 'finished') return reject(state, '对局已结束')

  switch (command.type) {
    case 'PLAY_CARD':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return playCard(state, command.player, command.instanceId, command.targetInstanceId)
    case 'END_PLAY':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return endPlay(state)
    case 'USE_HERO_SKILL':
      // 和出牌同一道门槛：只能在自己的出牌轮发动。技能本身免费，也不会结束这一轮出牌。
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      if (command.player !== state.activePlayer) return reject(state, '还没轮到你出牌')
      return useHeroSkill(state, command.player, command.targetInstanceId)
    case 'SUBMIT_ANSWERS':
      if (state.phase !== 'quiz') return reject(state, '现在不是答题阶段')
      return submitAnswers(state, command.results)
    case 'CONFIRM_ROUND':
      if (state.phase !== 'settle') return reject(state, '现在不是回合结算阶段')
      return confirmRound(state, command.player)
    // DEBUG_ADD_CARD / DEBUG_REMOVE_CARD 不限阶段：测试房要能在答题阶段先把手牌摆好。
    case 'DEBUG_ADD_CARD':
      return debugAddCard(state, command.player, command.cardId)
    case 'DEBUG_REMOVE_CARD':
      return debugRemoveCard(state, command.player, command.instanceId)
    case 'DEBUG_PLAY_CARD':
      // 和 PLAY_CARD 只差"轮到谁"这一条检查：测试房要能替对手出牌看结算动画。
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      return playCard(state, command.player, command.instanceId, command.targetInstanceId)
    case 'DEBUG_SKIP_TO_QUIZ':
      if (state.phase !== 'play') return reject(state, '现在不是出牌阶段')
      return skipToQuiz(state)
  }
}
