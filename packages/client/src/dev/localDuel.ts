/**
 * 开发页用的**本地一局**：引擎、演出编排层、一个照表出牌的对手，接成能真打的一局。
 *
 * 这是第 21 条 `localDriver` 之前的预览，不是它本身：这里没有存档、没有教程、
 * 没有真的答题模型，对手的每一步和每一次答题都是按一张固定的表算出来的。
 * 真 driver 落地时这个文件删掉。
 *
 * 时序上唯一要紧的一条：**先把指令交给引擎、再把事件喂给编排层**，
 * 而玩家那一下的 `UserAction` 要**赶在指令之前**发出去（场景已经按这个顺序发了，
 * 见 canvas 的 scenes/duel/input.ts）——编排层要靠它在事件回来之前把演出锁上上。
 */

import type { Director, DuelScene } from '@ai-duel/canvas'
import { createDirector, Rng } from '@ai-duel/canvas'
import { AI_MODEL_CARD_IDS, createCatalog, QUESTION_POOL } from '@ai-duel/content'
import type { AnswerResult, CardId, Command, GameEvent, GameState, PlayerId } from '@ai-duel/core'
import {
  createGame,
  effectivePlayCost,
  execute,
  filterEvent,
  getCard,
  other,
  viewFor,
} from '@ai-duel/core'

/** 玩家坐 0 号座位，对手坐 1 号。 */
const SEAT: PlayerId = 0
const FOE: PlayerId = other(SEAT)

/**
 * 对手每两步之间等多久（毫秒）。
 *
 * 不是「等演出播完」而是一个固定的节拍：演出播完才动的话，玩家看到的节奏会跟着
 * 每段动画的长短忽快忽慢；而这个数是照旧版对手的手感取的，够看清上一步发生了什么。
 */
const FOE_BEAT_MS = 1400

/** 牌组：18 张具名 AI 牌，取够 20 张。技能牌不进——它们的卡面图集这一局不装（纪律 3.4）。 */
function deckOf(): CardId[] {
  const deck: CardId[] = []
  while (deck.length < 20) deck.push(...AI_MODEL_CARD_IDS)
  return deck.slice(0, 20)
}

/**
 * 一个 AI 答得对不对：按实例 id 摊成一个整数再取模。
 *
 * 真答案要调模型（那是服务端的事，见架构 5.3），开发页只要一个**确定的**结果——
 * 同一局重开两次，同一张卡答的对错一样，看演出才有得比。
 */
function answerOf(instanceId: string, cardName: string): AnswerResult {
  let hash = 2166136261
  for (let i = 0; i < instanceId.length; i += 1) {
    hash ^= instanceId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const correct = (hash >>> 0) % 3 !== 0
  return {
    instanceId,
    correct,
    answer: correct ? '不咬人' : '咬人',
    reasoning: `${cardName}：这是开发页写死的一句理由。`,
  }
}

export interface LocalDuel {
  /** 玩家那一侧发来的指令。 */
  command(command: Command): void
  /** 推进一帧：走对手的节拍、推编排层的虚拟时钟、把新 cue 交给场景。 */
  step(deltaMs: number): void
  /** 这一局现在打到哪一步了，给开发页的状态栏读。 */
  status(): string
}

export function createLocalDuel(scene: DuelScene, seed: number): LocalDuel {
  const started = createGame({
    seed,
    catalog: createCatalog(),
    questionPool: QUESTION_POOL,
    players: [
      { name: '你', deck: deckOf(), hero: null },
      { name: '对手', deck: deckOf(), hero: null },
    ],
  })

  let state: GameState = started.state
  // 结算层逐卡作答的间隔用它。定种子，同一局重开两次演出一模一样。
  const director: Director = createDirector({ seat: SEAT, rng: new Rng(seed) })
  let beat = 0

  const feed = (events: readonly GameEvent[]): void => {
    const visible = events.map((event) => filterEvent(event, SEAT)).filter((one) => one !== null)
    const view = viewFor(state, SEAT)
    director.push({ events: visible, view })
    scene.applyView(view)
  }

  const run = (command: Command): void => {
    const result = execute(state, command)
    state = result.state
    feed(result.events)
  }

  feed(started.events)

  /** 对手这一拍该做什么。返回 false 表示现在轮不到它。 */
  const foeTurn = (): boolean => {
    if (state.phase === 'play' && state.activePlayer === FOE) {
      const player = state.players[FOE]
      const playable = player.hand.find((one) => {
        const card = getCard(state.catalog, one.cardId)
        // 只打 AI 牌：技能牌要选目标，而那条路归玩家自己点（开发页不替他决定）。
        return card.kind === 'ai' && effectivePlayCost(player, card) <= player.tokens
      })
      run(
        playable === undefined
          ? { type: 'END_PLAY', player: FOE }
          : { type: 'PLAY_CARD', player: FOE, instanceId: playable.instanceId },
      )
      return true
    }
    if (state.phase === 'quiz') {
      const results = [...state.players[0].board, ...state.players[1].board].map((ai) =>
        answerOf(ai.instanceId, getCard(state.catalog, ai.cardId).name),
      )
      run({ type: 'SUBMIT_ANSWERS', results })
      return true
    }
    if (state.phase === 'settle' && !state.settleConfirmed[FOE]) {
      run({ type: 'CONFIRM_ROUND', player: FOE })
      return true
    }
    return false
  }

  return {
    command: (command) => run(command),

    step(deltaMs) {
      beat += deltaMs
      if (beat >= FOE_BEAT_MS) {
        beat = 0
        foeTurn()
      }
      director.advance(deltaMs)
      const cues = director.drain()
      if (cues.length > 0) scene.play(cues)
      scene.setLocks(director.locks())
    },

    status() {
      if (state.phase === 'finished') {
        return state.winner === 'draw' ? '平局' : state.winner === SEAT ? '你赢了' : '你输了'
      }
      if (state.phase === 'quiz') return `第 ${state.round} 轮 · AI 答题中`
      if (state.phase === 'settle') return `第 ${state.round} 轮 · 结算`
      return state.activePlayer === SEAT
        ? `第 ${state.round} 轮 · 轮到你出牌`
        : `第 ${state.round} 轮 · 对方出牌中`
    },
  }
}
