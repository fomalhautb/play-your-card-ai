/**
 * 单机 driver：规则就在这台机器上跑，没有网络。
 *
 * 《正式版架构》5.6 那条「客户端只留两个 driver」的单机那一半。
 * 界面因此不知道自己是在单机还是在联机：两个 driver 是同一个 `MatchDriver` 接口，
 * 屏幕代码一行都不用分叉。
 *
 * ## 本地也只给场景裁剪视图
 *
 * 明明整份 `GameState` 就在手边，仍然过一遍 `viewFor` / `filterEvent`，是为了让
 * **场景在单机和联机下拿到的东西一模一样**。少了这一道，单机能画出题目答案、
 * 对手手牌这些联机根本拿不到的信息，等接上联机才发现界面依赖了不存在的字段。
 * 代价只是每条指令多拷一份视图，而那本来就是引擎每次 execute 都要做的事。
 *
 * ## 两种玩法，同一个 driver
 *
 * - **测试房**（`seat: 0`）：我方固定坐 0 号座，对手的指令由 DevPanel 或脚本发。
 *   固定座位而不是跟着行动方跑，是因为「替对方出牌」的入口要稳定指向同一边。
 *   注意 0 号不一定先出牌——第一轮先手由 `createGame` 抛硬币掷出。
 * - **热座**（`seat: 'active'`）：一台机器两个人轮流操作，视角跟着行动方走，
 *   轮到谁界面就把谁画成「我方」。
 *
 * ## 调试指令不走 `send`
 *
 * `MatchDriver.send` 只收四条玩家指令，`DEBUG_*` 从 `debug()` 进（见 driver.ts 的注释）。
 * 两条口子分开是为了让「联机时谁都不能发调试指令」这条在**类型上**就成立，
 * 而不是靠每个调用点自觉。
 */

import type { Command, GameEvent, GameSetup, GameState, PlayerId, PlayerView } from '@ai-duel/core'
import { createGame, execute, filterEvent, viewFor } from '@ai-duel/core'
import type { DebugCommand, PlayerCommand } from '@ai-duel/protocol'
import type { MatchDriver, MatchStatus, MatchView } from './driver'
import { createDriverCore } from './driverCore'
import { type AutopilotTimers, createQuizAutopilot, type QuizAnswersFor } from './quizAutopilot'

/**
 * 真实的定时器。单独拎出来是给 `localDriver` 的默认值用的——
 * 测试传自己那份假时钟（见 quizAutopilot 的 `AutopilotTimers`）。
 */
const REAL_TIMERS: AutopilotTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
}

export interface LocalDriverOptions {
  setup: GameSetup
  /** 本端座位。`'active'` 是热座：视角跟着行动方走（见文件头）。 */
  seat: PlayerId | 'active'
  /** 答题结果从哪来，不填就查 `content` 那份预生成的真实模型回答。 */
  answersFor?: QuizAnswersFor
  /** 进答题后隔多久自动提交（毫秒），不填就是 `QUIZ_AUTOPILOT_DELAY_MS`。 */
  quizDelayMs?: number
  /** 定时器入口，不填就是真的 setTimeout。测试传假时钟。 */
  timers?: AutopilotTimers
}

export interface LocalDriver extends MatchDriver {
  /**
   * 发一条调试指令（`DEBUG_*`）。只有单机才有这个口子，理由见文件头。
   * 面板发的指令走的是和正常出牌一模一样的 `execute` 路径，摆出来的局面和真打出来的没区别。
   */
  debug(command: DebugCommand): void
  /**
   * 未裁剪的完整局面。**只给 dev 测试面板用**：替对手出牌得先知道他手上有什么，
   * 而裁剪视图里对手的手牌连实例 id 都没有。
   *
   * 单机时「对手」就是同一个人，所以这里没有作弊可言；联机 driver 上不存在这个方法，
   * 那边的权威局面根本不在客户端。
   */
  peek(): GameState
}

/**
 * 这个 driver 是不是单机那一个。
 *
 * 界面拿它决定挂不挂测试面板：`MatchSession` 里存的是通用的 `MatchDriver`，
 * 而面板要的两个方法只有单机有。判两个方法在不在而不是加一个 `kind` 字段，
 * 是因为「有没有这两个口子」本来就是这里唯一要问的事。
 */
export function isLocalDriver(driver: MatchDriver): driver is LocalDriver {
  return 'debug' in driver && 'peek' in driver
}

/** 局面自己说了算的那部分状态。单机没有中断（`aborted`）——没有连接可断。 */
function statusOf(state: GameState): MatchStatus {
  return state.phase === 'finished' ? 'finished' : 'playing'
}

/** 这一批里有没有指令被拒；没有就返回 null，让上一条提示跟着新事件一起清掉。 */
function rejectionOf(events: readonly GameEvent[]): string | null {
  for (const event of events) {
    if (event.type === 'COMMAND_REJECTED') return event.reason
  }
  return null
}

export function createLocalDriver(options: LocalDriverOptions): LocalDriver {
  const opening = createGame(options.setup)
  let state: GameState = opening.state
  let disposed = false

  const seatOf = (): PlayerId => (options.seat === 'active' ? state.activePlayer : options.seat)

  /** 这一份局面裁剪给当前视角的样子。热座下同一份状态在换手后会裁出另一份。 */
  const viewNow = (): PlayerView => viewFor(state, seatOf())

  const core = createDriverCore({
    view: viewNow(),
    seat: seatOf(),
    status: statusOf(state),
    lastRejection: null,
    abortReason: null,
    // 单机没有链路可言，恒为通（见 driver.ts 的 MatchLink）。
    link: 'ok',
    // 单机没有房间，也就没有「对手在不在线」这回事。
    peer: null,
  })

  /**
   * 把一批事件裁剪好发出去，顺带更新快照。
   *
   * 先 patch 再 emitBatch：演出层每收一批都要拿新局面对账（见 driver.ts 的
   * `MatchEventBatch`），顺序反了它会拿着旧视图去播新事件。
   */
  const publish = (events: readonly GameEvent[]): void => {
    const seat = seatOf()
    const view = viewFor(state, seat)
    const changes: Partial<MatchView> = {
      view,
      seat,
      status: statusOf(state),
      lastRejection: rejectionOf(events),
    }
    core.patch(changes)
    const visible = events
      .map((event) => filterEvent(event, seat))
      .filter((event): event is GameEvent => event !== null)
    core.emitBatch({ events: visible, view })
  }

  const run = (command: Command): void => {
    if (disposed) return
    const result = execute(state, command)
    state = result.state
    publish(result.events)
    // 本地跑引擎的这一端负责生成答题结果，所以每条指令之后都要让自动驾驶看一眼。
    autopilot.observe(state)
  }

  const autopilot = createQuizAutopilot({
    getState: () => (disposed ? null : state),
    apply: run,
    ...(options.answersFor === undefined ? {} : { answersFor: options.answersFor }),
    ...(options.quizDelayMs === undefined ? {} : { delayMs: options.quizDelayMs }),
    timers: options.timers ?? REAL_TIMERS,
  })

  // 开局那批事件（抛硬币、发牌、第一轮开始）也要广播，演出层才知道要发牌。
  // 这时界面多半还没挂上来，driverCore 会替我们攒着（见它的文件头）。
  publish(opening.events)
  // 开局局面也过一遍：createGame 出来必定是出牌阶段，这一下只是把「上一次的阶段」记上。
  autopilot.observe(state)

  return {
    subscribe: core.subscribe,
    getSnapshot: core.getSnapshot,
    subscribeEvents: core.subscribeEvents,

    send(command: PlayerCommand) {
      run(command)
    },

    debug(command) {
      run(command)
    },

    peek: () => state,

    dispose() {
      disposed = true
      // 没有连接要断，但自动驾驶的定时器必须清掉，
      // 否则界面卸载之后它还会往一局已经没人看的对局里发指令。
      autopilot.dispose()
    },
  }
}
