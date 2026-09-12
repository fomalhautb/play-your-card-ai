/**
 * 教程控制器：把步骤表（steps.ts）跑起来。
 *
 * 三路输入汇到这里——引擎事件（`DuelStage` 在 `director.push` 之前多转一份）、
 * 舞台演出信号（`DuelScene.onTutorialCue`，也就是编排层那条 `tutorial` cue）、
 * 以及玩家点击——推着当前步骤往前走；两路输出交出去：给画布的限制
 *（哪几张手牌能打、「结束出牌」能不能点）和给引导层的提示（一句话 + 要圈的那几处）。
 *
 * 和旧版的唯一出入是**信号从哪来**：旧版靠 driver 的事件旁路（那时事件流的唯一订阅位
 * 被对局界面占着），新版两路都由 `DuelStage` 一处接线转过来，driver 一个字都不用为教程改。
 *
 * 纯讲解的步骤全部等玩家点一下才走，不排定时器自动跳；这里的定时器只剩两类：
 * readyOn 的等待（等一段演出）和弱引导（idleHint）。
 * 步骤推进的判定全在 machine.ts 的纯函数里，这里只负责「什么时候调它们」和排定时器。
 */

import type { DuelAnchorName, MatchStageCue } from '@ai-duel/canvas'
import type { CardId, GameEvent, InstanceId, PlayerView } from '@ai-duel/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TutorialDriver } from '../match/tutorialDriver'
import { useMatch } from '../match/useMatch'
import { TUTORIAL_PLAYER_SEAT } from './content'
import type { TutorialMachineState } from './machine'
import { allowanceOf, enterTutorialStep, pumpTutorial } from './machine'
import { TUTORIAL_FIRST_STEP, tutorialStep } from './steps'
import type { TutorialHighlight, TutorialSignal, TutorialStep, TutorialStepId } from './stepTypes'

/**
 * 一个已经换算好的高亮目标：卡牌定义 id 已经变成手上那张的实例 id。
 *
 * 步骤表按**卡牌定义 id** 写（实例 id 取决于发牌顺序，写进表里太脆），
 * 而画布只认实例 id——这一步换算要读局面，所以落在这里而不是步骤表里。
 */
export type TutorialTarget =
  | { kind: 'anchor'; name: DuelAnchorName }
  | { kind: 'card'; instanceId: InstanceId }

export interface TutorialControl {
  /** 当前这一步的完整定义。引导层拿它取提示文案和压暗开关。 */
  step: TutorialStep
  /** readyOn 都到齐了没有。没到齐时提示不出场（多半在等一段全屏过场演完）。 */
  ready: boolean
  /** 要圈的那几处，已经换算成画布问得出来的目标。 */
  targets: TutorialTarget[]
  /** 逐张手牌的锁：实例 id → 点它时说的那句话。null = 这一步不限制（第 3 轮放手）。 */
  blockedCards: ReadonlyMap<InstanceId, string> | null
  /** 「结束出牌」这一步许不许点。 */
  endPlayBlocked: boolean
  /** 这一步正等玩家点一下（提示已出场，且推进条件是 tap）。 */
  awaitingTap: boolean
  /** 玩家点了一下。没在等点击的时候调也无害，推进那一步会自己判掉。 */
  notifyTap(): void
  /** 引擎事件到了。`DuelStage` 在喂编排层**之前**转给这里。 */
  onEvents(events: readonly GameEvent[]): void
  /** 舞台演出信号到了。 */
  onCue(cue: MatchStageCue): void
  /** 走到终点步了：教学对战演完，该进完成页。 */
  done: boolean
}

/**
 * readyOn 等信号的兜底时限：超过这么久还没等齐就强行让提示出场。
 *
 * 取值要盖得住这里最长的那一段演出（答题揭晓层从立起到退场约 4~5 秒，加上后面
 * 一串轮次横幅约 3 秒），又不至于让真出问题时的等待长到玩家以为界面死了。
 */
const READY_TIMEOUT_MS = 12000

/** readyOn 里那几个 delay 的最长一个，用来排一条定时器（没有 delay 就返回 null）。 */
function longestDelay(signals: readonly TutorialSignal[]): number | null {
  let max: number | null = null
  for (const signal of signals) {
    if (signal.kind !== 'delay') continue
    if (max === null || signal.ms > max) max = signal.ms
  }
  return max
}

/**
 * 手牌里第一张这种卡的实例 id，**并且此刻真的打得出去**；否则返回 null。
 *
 * 判据和画布那边「这张牌灰不灰」一致（Token 不够）。要判这一下是因为高亮的含义是
 *「点这张」：牌买不起时就变灰了，还亮着圈只会让人反复去点它。
 */
function playableInstanceId(view: PlayerView | null, cardId: CardId): InstanceId | null {
  if (view === null) return null
  const instance = view.self.hand.find((item) => item.cardId === cardId)
  if (instance === undefined) return null
  const card = view.catalog.cards[cardId]
  if (card === undefined || card.tokenCost > view.self.tokens) return null
  return instance.instanceId
}

export function useTutorial(driver: TutorialDriver): TutorialControl {
  const match = useMatch(driver)
  const view = match.view
  const [stepId, setStepId] = useState<TutorialStepId>(TUTORIAL_FIRST_STEP)
  const [ready, setReady] = useState(false)
  const [idleHintOn, setIdleHintOn] = useState(false)

  /**
   * 机器本身的状态走 ref：事件是在 React 提交新快照**之前**同步送到的
   *（`DuelStage` 收到一批就立刻转过来），那时读 state 拿到的是上一次渲染的旧值。
   * 上面那两个 state 只是它的投影，供渲染用。
   */
  const machineRef = useRef<TutorialMachineState>(enterTutorialStep(TUTORIAL_FIRST_STEP))
  /** 本轮已经出现过的舞台信号，每轮 ROUND_STARTED 清空一次（理由见 machine.ts 的 seenCues）。 */
  const seenCuesRef = useRef(new Set<MatchStageCue>())
  const enteredAtRef = useRef(Date.now())

  /** 把状态机算出来的新状态落到 ref 和 state 上。换了一步就重新起算计时。 */
  const apply = useCallback((next: TutorialMachineState) => {
    const previous = machineRef.current
    machineRef.current = next
    if (next.stepId !== previous.stepId) {
      enteredAtRef.current = Date.now()
      setStepId(next.stepId)
      setIdleHintOn(false)
    }
    setReady(next.ready)
  }, [])

  /** 把当前这批输入喂给状态机（推进逻辑全在 machine.ts 的 pumpTutorial 里）。 */
  const pump = useCallback(
    (events: readonly GameEvent[], tapped = false) => {
      apply(
        pumpTutorial(machineRef.current, {
          seenCues: seenCuesRef.current,
          elapsedMs: Date.now() - enteredAtRef.current,
          events,
          tapped,
          playerSeat: TUTORIAL_PLAYER_SEAT,
        }),
      )
    },
    [apply],
  )

  const notifyTap = useCallback(() => {
    pump([], true)
  }, [pump])

  const onEvents = useCallback(
    (events: readonly GameEvent[]) => {
      // 换一轮就把本轮的信号记录清空，跨轮的同名信号才不会互相顶替。
      if (events.some((event) => event.type === 'ROUND_STARTED')) {
        seenCuesRef.current = new Set()
      }
      // 玩家一动手就有事件产生，正好拿它当「没闲着」的判据（弱引导见 idleHint）。
      setIdleHintOn(false)
      pump(events)
    },
    [pump],
  )

  const onCue = useCallback(
    (cue: MatchStageCue) => {
      seenCuesRef.current.add(cue)
      pump([])
    },
    [pump],
  )

  // 挂载后先泵一次：第一步的 readyOn 要是空的（进入即就绪），没人喊它就永远起不来。
  useEffect(() => {
    pump([])
  }, [pump])

  /**
   * readyOn 的两条定时器：
   *
   * - delay 那几个到点了喊一次 pump，由它按 elapsedMs 判定；
   * - 另外挂一条兜底：等了 READY_TIMEOUT_MS 还没等到信号就强行就绪。
   *   readyOn 等的全是舞台演出信号，而演出可能因为各种边角情况没跑到收尾
   *  （比如技能命中那一段找不到目标格子，就不会有 'skill-hit'）。
   *   等不到信号最坏也只是提示晚出来、或者压在过场上，总好过整段教程冻死。
   */
  useEffect(() => {
    const signals = tutorialStep(stepId).readyOn ?? []
    if (signals.length === 0 || machineRef.current.ready) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const ms = longestDelay(signals)
    if (ms !== null) timers.push(setTimeout(() => pump([]), ms))
    timers.push(
      setTimeout(() => {
        if (machineRef.current.ready) return
        // 清空待办等于「不等了」，下面这一泵就会让提示出场。
        machineRef.current = { ...machineRef.current, pendingReady: [] }
        pump([])
      }, READY_TIMEOUT_MS),
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [stepId, pump])

  // 弱引导（规格 §9）：第 3 轮长时间没操作才轻微高亮，不压暗也不弹规则说明。
  useEffect(() => {
    const hint = tutorialStep(stepId).idleHint
    if (hint === undefined || !ready || idleHintOn) return
    const timer = setTimeout(() => setIdleHintOn(true), hint.afterMs)
    return () => clearTimeout(timer)
  }, [stepId, ready, idleHintOn])

  // 对手脚本的闸门：只有明确要它动手的那几步才放行（见 steps.ts 的 releaseFoe）。
  useEffect(() => {
    driver.setFoeHold(tutorialStep(stepId).releaseFoe !== true)
  }, [driver, stepId])

  const step = tutorialStep(stepId)
  const allowance = allowanceOf(step)
  const hand = view?.self.hand

  const blockedCards = useMemo(() => {
    const playable = allowance.playableCards
    if (playable === null || hand === undefined) return null
    const tips = new Map<InstanceId, string>()
    for (const instance of hand) {
      if (!playable.includes(instance.cardId)) tips.set(instance.instanceId, allowance.blockTip)
    }
    return tips
  }, [hand, allowance])

  const targets = useMemo(() => {
    if (!ready) return []
    const wanted: TutorialHighlight[] = [...(step.highlight ?? [])]
    if (idleHintOn && step.idleHint !== undefined) wanted.push(...step.idleHint.highlight)
    const out: TutorialTarget[] = []
    for (const one of wanted) {
      if (one.kind === 'anchor') {
        out.push({ kind: 'anchor', name: one.name })
        continue
      }
      const instanceId = playableInstanceId(view, one.cardId)
      if (instanceId !== null) out.push({ kind: 'card', instanceId })
    }
    return out
  }, [ready, step, idleHintOn, view])

  return {
    step,
    ready,
    targets,
    blockedCards,
    endPlayBlocked: !allowance.endPlay,
    awaitingTap: ready && step.advance?.kind === 'tap',
    notifyTap,
    onEvents,
    onCue,
    done: step.next === null,
  }
}
