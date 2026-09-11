/**
 * 教学对战三份测试共用的脚手架：开一局、把定时器跑干净、替玩家点那几下。
 *
 * 拆出来是因为单文件不能超过 400 行（架构 7.2 第 3 条），而旧版那份
 * 黑客松版的 `test/tutorial.test.ts` 是 558 行的一整块；搬过来时按
 * 「剧本」「内容自检」「步骤表」切成三份，这些小工具三边都要用。
 *
 * 两个延迟（对手每一步、答题自动提交）都注入成 0，再配假定时器，整份测试是同步跑完的。
 */

import type { CardId, GameEvent, GameState, InstanceId } from '@ai-duel/core'
import { vi } from 'vitest'
import type { TutorialDriver } from '../../src/match/tutorialDriver'
import { createTutorialDriver } from '../../src/match/tutorialDriver'
import { TUTORIAL_CARDS } from '../../src/tutorial/content'

export const PLAYER = 0
export const FOE = 1

/** 一局教学对战，外加一份按顺序攒下来的事件流。 */
export interface TutorialRun {
  driver: TutorialDriver
  events: GameEvent[]
}

/**
 * 开一局。事件从 `subscribeEvents` 收——那正是真界面上 `DuelStage` 订的那一条
 *（教程的事件信号也是从它那儿转出去的，见 tutorialDriver 的文件头）。
 *
 * 想在事件到达时顺手做点什么（模拟教程控制器同步关上对手那道闸）要走 `onBatch`，
 * **不能再订一次**：`subscribeEvents` 全局只允许一个订阅者，第二次会把第一次顶掉，
 * 于是 `events` 从那一刻起就不再攒东西了（见 match/driverCore.ts）。
 */
export function start(onBatch?: (events: readonly GameEvent[]) => void): TutorialRun {
  const driver = createTutorialDriver({ stepDelayMs: 0, quizDelayMs: 0 })
  const events: GameEvent[] = []
  driver.subscribeEvents((batch) => {
    events.push(...batch.events)
    onBatch?.(batch.events)
  })
  return { driver, events }
}

/**
 * 把所有到点的定时器跑完，直到一个都不剩。
 *
 * 对手脚本和答题自动提交是一条互相触发的链（出牌 → 结束出牌 → 答题 → 下一轮 → 再出牌），
 * 一次 runOnlyPendingTimers 只推得动一环，所以要循环。上限纯粹是防死循环。
 */
export function flush(): void {
  for (let guard = 0; guard < 100 && vi.getTimerCount() > 0; guard += 1) {
    vi.runOnlyPendingTimers()
  }
}

export function stateOf(driver: TutorialDriver): GameState {
  return driver.peek()
}

function handInstance(driver: TutorialDriver, cardId: CardId): InstanceId {
  const instance = stateOf(driver).players[PLAYER].hand.find((item) => item.cardId === cardId)
  if (instance === undefined) throw new Error(`手牌里没有 ${cardId}`)
  return instance.instanceId
}

export function play(driver: TutorialDriver, cardId: CardId, targetInstanceId?: InstanceId): void {
  driver.send({
    type: 'PLAY_CARD',
    player: PLAYER,
    instanceId: handInstance(driver, cardId),
    ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
  })
}

export function endPlay(driver: TutorialDriver): void {
  driver.send({ type: 'END_PLAY', player: PLAYER })
}

/**
 * 玩家在结算层上点「进入下一轮」。
 *
 * 对手那一下由 driver 自己代点（见 tutorialDriver 的 pumpFoeConfirm），
 * 玩家这一下在真界面上是结算层按钮的一次点击，测试里只能手动补。
 * 双方都确认之后才会推进下一轮，所以每一轮结算后都要调它一次。
 */
export function confirmRound(driver: TutorialDriver): void {
  driver.send({ type: 'CONFIRM_ROUND', player: PLAYER })
}

/** 对手场上唯一那个 AI（教学脚本保证每轮至多一个）。 */
export function foeAiId(driver: TutorialDriver): InstanceId {
  const ai = stateOf(driver).players[FOE].board[0]
  if (ai === undefined) throw new Error('对手场上没有 AI')
  return ai.instanceId
}

export function scoredEvents(events: readonly GameEvent[]) {
  return events.filter((event) => event.type === 'ROUND_SCORED')
}

/**
 * 走完第 1 轮（玩家打指定 AI → 结束出牌 → 对手 gpt-4o → 答题 → 双方确认结算），
 * 停在第 2 轮玩家可以出牌的那一刻（对手已经派出 deepseek-r1 并结束了出牌）。
 */
export function playThroughRoundOne(run: TutorialRun): void {
  flush()
  play(run.driver, TUTORIAL_CARDS.firstAi)
  endPlay(run.driver)
  flush()
  confirmRound(run.driver)
  flush()
}
