/**
 * 教学对战状态机的推进：一批输入进来，能推几步推几步。
 *
 * 从黑客松版的 `src/tutorial/steps.ts` 的后半段搬过来，一行逻辑都没改。
 * 全是纯函数，不碰 React 也不碰 DOM，所以整条推进逻辑能直接断言
 *（controller.ts 那层只负责「什么时候调它们」和排定时器）。
 */

import type { MatchStageCue } from '@ai-duel/canvas'
import type { GameEvent, PlayerId } from '@ai-duel/core'
import { TUTORIAL_STEPS, tutorialStep } from './steps'
import type {
  TutorialAllowance,
  TutorialEventSignal,
  TutorialSignal,
  TutorialStep,
  TutorialStepId,
} from './stepTypes'

/** 过渡态里手牌一律锁着时点上去弹的话。 */
const CUTSCENE_TIP = '教学演出还没走完，先看这一段'

/** 过渡态的默认限制：什么都不许做。 */
const CUTSCENE_ALLOWANCE: TutorialAllowance = {
  playableCards: [],
  blockTip: CUTSCENE_TIP,
  endPlay: false,
}

/** 这一步允许玩家做什么。没写 allow 的过渡态一律锁死。 */
export function allowanceOf(step: TutorialStep): TutorialAllowance {
  return step.allow ?? CUTSCENE_ALLOWANCE
}

/**
 * 一条事件符不符合信号里写的条件。
 *
 * `by` 要拿本端座位换算：步骤表只说「我方 / 对方」，不写座位号——
 * 教程虽然固定坐 0 号，但这条判定没必要跟着那个约定走。
 */
function eventMatches(
  signal: TutorialEventSignal,
  event: GameEvent,
  playerSeat: PlayerId,
): boolean {
  if (event.type !== signal.type) return false
  if (signal.by === undefined) return true
  if (!('player' in event)) return false
  const mine = event.player === playerSeat
  return signal.by === 'me' ? mine : !mine
}

/** 判定一个信号要用到的全部上下文，全是「到目前为止发生了什么」。 */
export interface TutorialSignalContext {
  /**
   * 本轮已经出现过的舞台信号。
   *
   * 之所以要记而不是只认「刚到的那一条」：好几步是在信号已经过去之后才被切进来的
   *（比如第 3 轮的补牌和横幅早就演完了，教程还在念第 2 轮的结算），
   * 认不出「已经发生过」就会卡在那儿等一条永远不会再来的信号。
   * 每轮 `ROUND_STARTED` 清空一次，跨轮的同名信号才不会互相顶替。
   */
  seenCues: ReadonlySet<MatchStageCue>
  /** 进入这一步之后过了多久（毫秒）。只有 readyOn 里的 delay 会看它。 */
  elapsedMs: number
  /** 这一批新到的引擎事件。 */
  events: readonly GameEvent[]
  /**
   * 这批输入里有没有一次玩家点击（点屏幕或点「下一步」）。
   *
   * 一次点击只算数一次：推完一步 tap 就把它划掉再往下判，
   * 否则连着几步纯讲解会被同一下点击一口气翻完（见 pumpTutorial）。
   */
  tapped: boolean
  playerSeat: PlayerId
}

/** 一个信号现在成立没有。四种信号各查各的来源，互不相干。 */
export function signalSatisfied(signal: TutorialSignal, context: TutorialSignalContext): boolean {
  switch (signal.kind) {
    case 'cue':
      return context.seenCues.has(signal.cue)
    case 'delay':
      return context.elapsedMs >= signal.ms
    case 'tap':
      return context.tapped
    case 'event':
      return context.events.some((event) => eventMatches(signal.event, event, context.playerSeat))
  }
}

/** 这一步走得动的话，往哪走、这一下点击是不是被它吃掉了。 */
interface TutorialAdvanceResult {
  next: TutorialStepId
  /** 这一步是被点击推走的，那这一下点击就用完了（见 pumpTutorial）。 */
  tapConsumed: boolean
}

/** 当前这一步现在能不能往下走。走不动（含终点步）返回 null。 */
function tryAdvance(
  step: TutorialStep,
  context: TutorialSignalContext,
): TutorialAdvanceResult | null {
  const advance = step.advance
  if (advance === undefined || step.next === null) return null
  if (!signalSatisfied(advance, context)) return null
  return { next: step.next, tapConsumed: advance.kind === 'tap' }
}

/**
 * 状态机跑到哪了。控制器把它存在 ref 里，推进本身是下面那个纯函数。
 * 拆成「纯状态 + 纯函数」是为了让整条推进逻辑不用渲染 React 就能测。
 */
export interface TutorialMachineState {
  stepId: TutorialStepId
  /** 这一步的 readyOn 都到齐了，提示已经出场。 */
  ready: boolean
  /** 还差哪几个 readyOn 没到。拷贝出来的，不会动到步骤表里那个数组。 */
  pendingReady: readonly TutorialSignal[]
}

/** 刚进入某一步时的状态：readyOn 原样抄一份当待办清单。 */
export function enterTutorialStep(stepId: TutorialStepId): TutorialMachineState {
  return { stepId, ready: false, pendingReady: [...(tutorialStep(stepId).readyOn ?? [])] }
}

/**
 * 把一批输入喂给状态机，能推几步推几步。
 *
 * 循环是必要的：一批事件（或一条信号）可能同时满足「这一步就绪」和「这一步走完」，
 * 甚至连着满足下一步的就绪条件。上限取步骤表长度，防着数据写错时空转。
 *
 * 两条不显然的规矩：
 *
 * - **一次点击只推一步**。推走一步 tap 之后就把这一下点击划掉，后面的步骤看到的是
 *   「没人点」。纯讲解的步骤有连着三步的（R2_REFRESH→R2_TOKEN→R2_DRAW），
 *   而且它们 readyOn 为空、进入即就绪，不划掉的话一下点击会把三句话一口气翻完。
 * - **没就绪就不看推进条件**。提示还没出场（多半在等一段全屏过场）时玩家点的那一下不算数。
 */
export function pumpTutorial(
  state: TutorialMachineState,
  context: TutorialSignalContext,
): TutorialMachineState {
  let current = state
  let tapped = context.tapped
  // 每往前进一步就是「刚进来」，计时归零：readyOn 的 delay 说的是进入这一步之后等多久。
  let elapsedMs = context.elapsedMs
  for (let guard = 0; guard < TUTORIAL_STEPS.length; guard += 1) {
    const now: TutorialSignalContext = { ...context, tapped, elapsedMs }
    if (!current.ready) {
      const pendingReady = current.pendingReady.filter((signal) => !signalSatisfied(signal, now))
      current = { ...current, pendingReady, ready: pendingReady.length === 0 }
    }
    if (!current.ready) return current

    const move = tryAdvance(tutorialStep(current.stepId), now)
    if (move === null) return current
    if (move.tapConsumed) tapped = false
    elapsedMs = 0
    current = enterTutorialStep(move.next)
  }
  return current
}
