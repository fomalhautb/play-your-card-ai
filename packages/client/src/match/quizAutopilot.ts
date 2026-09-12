/**
 * 答题阶段的自动驾驶：进入 quiz 之后隔一小会儿替引擎把本轮答题结果提交上去。
 *
 * 为什么要有这么一层：`SUBMIT_ANSWERS` 不是玩家能点出来的指令，它代表「场上这批 AI
 * 已经答完题了」。跑引擎的那一端负责生成结果——单机就是这里，联机是房间 Durable Object
 *（见《正式版架构》5.3，那边用 DO 的 alarm 计时，所以联机 driver 一行都不接这个模块）。
 * 默认结果来自 `content` 的 `scriptedAnswers`，也就是那份离线预生成的真实模型回答表。
 *
 * 延迟纯粹是给界面留出播「揭晓题目 + AI 作答中」的时间，不追求和演出精确对齐：
 * 演出层收不到结果只是少播一段，不会把局面卡住。
 */

import { scriptedAnswers } from '@ai-duel/content'
import type {
  AiInstance,
  AnswerResult,
  Command,
  GamePhase,
  GameState,
  Question,
} from '@ai-duel/core'

/** 进入答题阶段后等多久自动提交结果（毫秒）。 */
export const QUIZ_AUTOPILOT_DELAY_MS = 2500

/**
 * 生成本轮答题结果的那一步，形状和 `content` 的 `scriptedAnswers` 一致。
 *
 * 单独起个类型名是为了让「换一份结果来源」变成传一个参数：教程（第 32 条）要把每一轮的
 * 对错写死，将来改成对局中途真去调模型 API 也是换掉这一处实现，
 * 指令形状和这一层的时序都不用动。
 */
export type QuizAnswersFor = (question: Question, aiUnits: readonly AiInstance[]) => AnswerResult[]

/**
 * 定时器的注入口。
 *
 * 不直接用全局的 `setTimeout`：那样这一层的时序就只能靠真等两秒半才测得到。
 * 形状故意和全局那两个一样，真跑时调用方直接把它们传进来。
 */
export interface AutopilotTimers {
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(id: number): void
}

export interface QuizAutopilotOptions {
  /**
   * 取当前局面。
   *
   * 定时器到点时必须读**最新**的一份，而不是排定时器那一刻的快照：这中间玩家还能用
   * 测试面板改手牌，拿旧快照算出来的结果会和场上对不上，被引擎整条拒掉。
   */
  getState(): GameState | null
  /** 把指令喂给引擎，和玩家自己发指令走同一条路径。 */
  apply(command: Command): void
  /** 延迟毫秒数，留给测试调短。 */
  delayMs?: number
  /** 结果从哪来，不填就是 `content` 的 `scriptedAnswers`。 */
  answersFor?: QuizAnswersFor
  timers: AutopilotTimers
}

export interface QuizAutopilot {
  /** 每执行完一条指令调用一次，传入执行后的最新局面。 */
  observe(state: GameState | null): void
  /** 清掉还没到点的定时器。driver dispose 时必须调，否则界面都卸载了它还会往引擎发指令。 */
  dispose(): void
}

export function createQuizAutopilot(options: QuizAutopilotOptions): QuizAutopilot {
  const { getState, apply, timers } = options
  const delayMs = options.delayMs ?? QUIZ_AUTOPILOT_DELAY_MS
  const answersFor = options.answersFor ?? scriptedAnswers

  let timer: number | null = null
  /**
   * 上一次看到的阶段。只在「从非 quiz 变成 quiz」这个**变化沿**上排一次定时器：
   * 答题阶段里测试面板照样能发 DEBUG_ADD_CARD 之类的指令，每条都触发的话会排出好几个
   * 定时器，同一轮被提交多次（第二次起会被引擎拒掉，但事件流里会多出噪音）。
   */
  let lastPhase: GamePhase | null = null
  let disposed = false

  const clear = (): void => {
    if (timer === null) return
    timers.clearTimeout(timer)
    timer = null
  }

  const submit = (): void => {
    timer = null
    if (disposed) return
    const state = getState()
    // 到点时局面可能已经不在答题阶段了（比如测试面板手动推进过），那就什么都不做。
    if (state === null || state.phase !== 'quiz') return
    const question = state.questions[state.round - 1]
    if (question === undefined) return
    /*
     * 双方在场的 AI 合并成一批一起答题，顺序固定为「0 号玩家的场，然后 1 号玩家的场」。
     * 顺序要固定是因为 `scriptedAnswers` 会按同一批里的下标挑变体，
     * 两端各排各的顺序就会算出不一样的结果。
     */
    const aiUnits = [...state.players[0].board, ...state.players[1].board]
    apply({ type: 'SUBMIT_ANSWERS', results: answersFor(question, aiUnits) })
  }

  return {
    observe(state) {
      if (disposed) return
      const phase = state?.phase ?? null
      if (phase === 'quiz' && lastPhase !== 'quiz') {
        clear()
        timer = timers.setTimeout(submit, delayMs)
      }
      lastPhase = phase
    },
    dispose() {
      disposed = true
      clear()
    },
  }
}
