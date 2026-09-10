/**
 * 把真场景包成剧本认得的样子：一局脚本化对局 + 演出编排层 + 对局渲染器。
 *
 * 剧本说的是「开局发牌」「连着打十张」，而场景认得的只有 `PlayerView` / `Cue` / `DirectorLocks`
 *（它不认识引擎事件，也不认识 driver，见 canvas 的 duelContract.ts）。中间这一段——
 * 开一局、发指令、把事件喂给编排层、把 cue 交给场景、按同一条时钟推——就是这个文件。
 * 它在真客户端里对应第 21 条的 `localDriver`；那条落地之后这里应该改成直接用它。
 *
 * 确定性（6.9 的前提）靠四样：`noShuffle` 让牌序完全由牌组数组决定、`firstPlayer` 跳过
 * 抛硬币那次随机、编排层的随机数定种子、指令按「上一段演完了才发下一条」排而不是按墙钟排。
 */

import {
  createDirector,
  createDuelScene,
  type Director,
  type DuelScene,
  Rng,
} from '@ai-duel/canvas'
import type {
  AnswerResult,
  Command,
  GameEvent,
  GamePhase,
  GameState,
  PlayerId,
} from '@ai-duel/core'
import {
  createGame,
  effectivePlayCost,
  execute,
  filterEvent,
  getCard,
  viewFor,
} from '@ai-duel/core'
import type { BenchScene, BenchSceneOptions, DuelCommand } from './contract'
import { BENCH_CATALOG, BENCH_DECK, BENCH_QUESTIONS } from './duelScript'

/** 剧本从 0 号座位看这一局。 */
const SEAT: PlayerId = 0

/** 热身那一遍每帧按多少倍步长推。15 倍正好把 16.667 毫秒放成 250。 */
const WARMUP_SPEED = 15

export async function createDuelSession(options: BenchSceneOptions): Promise<BenchScene> {
  const scene: DuelScene = await createDuelScene({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    tier: options.tier,
    seat: SEAT,
    textures: options.textures,
    catalog: BENCH_CATALOG,
    seed: options.seed,
    manualClock: options.manualClock,
  })
  /*
   * 场景发出来的指令只记账、不执行。
   *
   * 三段确定性剧本自己按脚本发指令，场景那边发出来的执行了就等于同一下算了两次；
   * 而交互用例（tests/interaction.spec.ts）一条指令都不发，它要的正是这张表——
   * 「玩家这一串真指针操作，最后让场景发出了什么」。
   */
  const commands: DuelCommand[] = []
  scene.onCommand((command) => commands.push(command))
  scene.onUserAction(() => undefined)
  scene.onTutorialCue(() => undefined)

  /** 开一局。牌序、题序、先手全部定死，同一段剧本跑两遍才会一模一样。 */
  function startGame(): { state: GameState; events: GameEvent[] } {
    const started = createGame({
      seed: 20260905,
      catalog: BENCH_CATALOG,
      questionPool: BENCH_QUESTIONS,
      questions: BENCH_QUESTIONS,
      players: [
        { name: '甲', deck: [...deck], hero: null },
        { name: '乙', deck: [...deck], hero: null },
      ],
      firstPlayer: SEAT,
      noShuffle: true,
    })
    return { state: started.state, events: started.events }
  }

  /** 这一局的牌组。交互用例会换一副带技能牌的（见 contract.ts 的 `deck`）。 */
  const deck: readonly string[] = options.deck ?? BENCH_DECK

  let opening = startGame()
  let state: GameState = opening.state
  let director: Director = createDirector({ seat: SEAT, rng: new Rng(options.seed) })
  let warm = false
  /** 等着「场景空下来」的那些动作。每帧末尾检查一次。 */
  let waiters: (() => void)[] = []

  /** 把一批事件喂给编排层和场景，并立刻把这一刻产生的 cue 交出去。 */
  function feed(events: readonly GameEvent[]): void {
    const visible = events.map((event) => filterEvent(event, SEAT)).filter((one) => one !== null)
    const view = viewFor(state, SEAT)
    director.push({ events: visible, view })
    scene.applyView(view)
    drain()
  }

  function drain(): void {
    const cues = director.drain()
    if (cues.length > 0) scene.play(cues)
    scene.setLocks(director.locks())
  }

  function run(command: Command): void {
    const result = execute(state, command)
    state = result.state
    feed(result.events)
  }

  /**
   * 这一段演出真的完了：渲染器闲下来了，**而且**编排层排下的期也跑完了。
   *
   * 两个都要看。低效果档不播落地那圈亮环，画面会比编排层先静止下来——
   * 只看渲染器的话，剧本会在最后一条 cue（放锁）发出来之前就收工，
   * 那一下于是落进了「空转期间不许再渲染」的窗口里，把 3.6 那条计数器顶穿。
   */
  function idle(): boolean {
    return scene.isIdle() && director.isIdle()
  }

  /** 等到这一段演完。剧本的 `act` 会一直推帧，直到这个 Promise 兑现。 */
  function untilIdle(): Promise<void> {
    if (idle()) return Promise.resolve()
    return new Promise((resolve) => waiters.push(resolve))
  }

  /** 当前该出牌的那一方手里第一张打得起的 AI 牌。 */
  function nextPlayable(): { player: PlayerId; instanceId: string } | null {
    if (state.phase !== 'play') return null
    const player = state.players[state.activePlayer]
    const card = player.hand.find((one) => {
      const definition = getCard(state.catalog, one.cardId)
      return definition.kind === 'ai' && effectivePlayCost(player, definition) <= player.tokens
    })
    return card === undefined ? null : { player: player.id, instanceId: card.instanceId }
  }

  return {
    async restart() {
      scene.reset()
      opening = startGame()
      state = opening.state
      director = createDirector({ seat: SEAT, rng: new Rng(options.seed) })
      waiters = []
      // 开局那一批：抛硬币过场、两条横幅、双方各五张开局手牌。
      feed(opening.events)
      await untilIdle()
    },

    /**
     * 连着打 n 张。
     *
     * 一张一张打、每张等演出收完再打下一张——这正是玩家的节奏，也是演出锁的口径
     *（编排层在出牌那一刻上锁，落地特效演完才放，见 director/locks.ts）。
     * 一口气全发出去的话十段演出会叠在同一刻，量到的不是任何真实情况。
     * 打不动了就结束出牌换对方；对方那几张走强制展示，是这段剧本里最重的一段演出。
     */
    async playCards(count) {
      for (let played = 0; played < count; played += 1) {
        let next = nextPlayable()
        if (next === null) {
          if (state.phase !== 'play') break
          run({ type: 'END_PLAY', player: state.activePlayer })
          await untilIdle()
          next = nextPlayable()
          if (next === null) break
        }
        run({ type: 'PLAY_CARD', player: next.player, instanceId: next.instanceId })
        await untilIdle()
      }
    },

    /** 放大查看战场上第 index 个单位，看完关回去。两下都走编排层，和玩家点的是同一条路。 */
    async inspect(index) {
      const units = [...state.players[0].board, ...state.players[1].board]
      const target = units[index % Math.max(1, units.length)]
      if (target === undefined) return
      director.userAction({ kind: 'inspect-open', source: 'tile', flipId: target.instanceId })
      drain()
      await untilIdle()
      director.userAction({ kind: 'inspect-close' })
      drain()
      await untilIdle()
    },

    /**
     * 走完一轮结算。
     *
     * 答案由这里直接编（不查 content 的离线回答表——bench 不依赖 content，见 duelScript.ts）：
     * 我方全对、对方全错，好让结算层上「对」「错」两种判定和比分变化都演到。
     * 每一步之间都等演出收完再发下一条，和玩家的节奏一致（同 playCards 的理由）。
     */
    async settleRound() {
      // 走函数读阶段：`run()` 会整个换掉 state，而 TypeScript 看不出闭包里那次赋值，
      // 直接读 state.phase 会被上一次比较收窄成一个不可能再变的字面量。
      const phaseNow = (): GamePhase => state.phase
      while (phaseNow() === 'play') {
        run({ type: 'END_PLAY', player: state.activePlayer })
        await untilIdle()
      }
      if (phaseNow() !== 'quiz') return
      const results: AnswerResult[] = [...state.players[0].board, ...state.players[1].board].map(
        (ai) => ({
          instanceId: ai.instanceId,
          correct: ai.owner === SEAT,
          answer: ai.owner === SEAT ? '剧本里的正确回答' : '剧本里的错误回答',
          reasoning: '剧本用的占位推理，两行以内。',
        }),
      )
      run({ type: 'SUBMIT_ANSWERS', results })
      await untilIdle()
      // 双方都确认过这一轮才真的翻页，结算层也才退场。
      for (const player of [0, 1] as const) {
        if (phaseNow() !== 'settle') break
        run({ type: 'CONFIRM_ROUND', player })
        await untilIdle()
      }
    },

    setWarmup(next) {
      warm = next
    },

    step(deltaMs) {
      const delta = warm ? deltaMs * WARMUP_SPEED : deltaMs
      director.advance(delta)
      drain()
      scene.step(delta)
      if (waiters.length > 0 && idle()) {
        const pending = waiters
        waiters = []
        for (const resolve of pending) resolve()
      }
    },

    isIdle: () => idle(),
    commands: () => commands,
    handCards: () =>
      state.players[SEAT].hand.map(({ instanceId, cardId }) => ({ instanceId, cardId })),
    counters: () => scene.counters(),
    resize: (width, height) => scene.resize(width, height),
    destroy: () => scene.destroy(),
  }
}
