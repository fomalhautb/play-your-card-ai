/**
 * 编排层的共用底座：虚拟时钟、排程队列、cue 收集，以及五套排队 / 闸门机制共享的那份状态。
 *
 * 为什么全部状态挤在一个对象里：旧版这些是十几个 React ref，彼此的判据交叉引用
 *（横幅要看展示层忙不忙、展示层要看三个全屏过场在不在、抵消层三样都要看）。
 * 拆成各自私有的模块之后，那些判据就得靠一层层传参重新拼出来，比现在难读得多。
 * 所以状态集中、逻辑按机制分文件：banner.ts、reveal.ts、locks.ts、deal.ts、settleTimeline.ts
 * 各自只碰属于自己的那几个字段，谁碰了什么在各文件的头注释里写明。
 *
 * 时钟是虚拟的：`advance(ms)` 之前什么都不会自己发生。旧版靠 GSAP 的 `onComplete`
 * 串联后续，这里改成「按已知时长排期」，测试才能用假时钟一步步喂。
 */

import type {
  CardId,
  HeroId,
  InstanceId,
  PlayerId,
  PlayerView,
  PublicQuestion,
} from '@ai-duel/core'
import type { Rng } from '../runtime/rng'
import type { Cue, CueSpec } from './cues'

/** 排好期还没跑的一件事。`cancel()` 之后它不会再跑，重复调用无害。 */
interface ScheduledTask {
  readonly at: number
  cancel(): void
}

interface Task {
  at: number
  /** 同一毫秒上按登记先后跑，保证排程顺序确定，不受数组扫描顺序影响。 */
  seq: number
  run: () => void
  canceled: boolean
}

/** 憋着还没演的抵消提示（旧版 `pendingCancelRef`）。 */
export interface PendingCancel {
  heroId: HeroId
  title: string
  text: string
}

/** 结算层里的一行结果，随 `AI_ANSWERED` 一条条攒起来。 */
export interface SettleRow {
  instanceId: InstanceId
  cardId: CardId
  mine: boolean
  correct: boolean
  answer: string
  reasoning: string
  /** 答错了但被「保送」留在场上，由随后的 `AI_SAFE_PASSED` 打上。 */
  safePassed: boolean
}

/** 一次强制展示排下的东西，收场时只收自己这一份。 */
export interface ShowcaseRun {
  tasks: ScheduledTask[]
  /** 落场那一段拿的锁；没走到落场就是 null。 */
  landingToken: number | null
}

/** 正在立着的回合结算层。 */
interface SettleState {
  /** 整层立起来的虚拟时刻。读题要等够 `SETTLE_READ_HOLD_MS`，等的是「还差多少」。 */
  openedAt: number
  round: number
  question: PublicQuestion
  rows: SettleRow[]
  /** 主线排下的全部排程。退场时要整条掐掉（旧版 `mainRef.kill()`）。 */
  tasks: ScheduledTask[]
  /** 确认按钮已经淡入落地，这时才点得动（旧版 RoundSettleLayer 自己的 ready）。 */
  ready: boolean
  /** 玩家已经点过确认，按钮改成等对方（旧版那一层自己的本地标志）。 */
  confirmed: boolean
  /** 退场已经起跑，别再重复触发。 */
  exiting: boolean
}

export interface DirectorContext {
  readonly seat: PlayerId
  /** 结算层逐卡作答的随机间隔用它。定种子，同一局重放两遍 cue 序列逐条相同。 */
  readonly rng: Rng
  /** 当前虚拟时刻（毫秒）。只有 `advance` 会推它。 */
  now: number

  /** 记一条演出指令，时刻取当前虚拟时刻。 */
  emit(spec: CueSpec): void
  /** 排一件将来要做的事；`delayMs` 为 0 表示「本次 advance 走到这一刻就做」。 */
  schedule(delayMs: number, run: () => void): ScheduledTask
  /** 推进虚拟时钟，把到期的排程按时刻依次跑掉。 */
  advance(ms: number): void
  /** 取走自上次以来产生的 cue，按 `at` 升序。 */
  drain(): Cue[]
  /** 掐掉全部排程（对局中断时的一次性清场）。 */
  cancelAll(): void

  // ---------- 四道闸门（旧版 MatchStage 的四个 ref）。任一为真时横幅只入队不播。 ----------
  /** 抛硬币过场立着。 */
  coinUp: boolean
  /** 答题 / 回合结算层立着。 */
  quizUp: boolean
  /** 英雄技能抵消层立着。 */
  cancelUp: boolean
  /** 展示层占着（强制展示，含收尾还没跑完）。 */
  revealBusy: boolean
  /**
   * 我方技能牌亮相还有几段在演。
   * 用计数不是布尔：连打两张时上一张的时间线还没跑完，布尔会被第一条收尾提前清掉。
   */
  skillShowBusy: number

  // ---------- 横幅与抵消层（banner.ts） ----------
  bannerQueue: string[]
  bannerBusy: boolean
  pendingCancel: PendingCancel | null

  // ---------- 展示层（reveal.ts） ----------
  /** 正在放大查看的那张卡；null 表示没有。 */
  inspecting: { source: 'tile' | 'hero'; flipId: string } | null
  /** 放大查看已经飞到位，这时点遮罩才关得掉。 */
  inspectHeld: boolean
  /** 放大查看的飞入或飞回还在路上。这一拍里不受理强制展示（会把起飞状态丢掉）。 */
  inspectFlying: boolean
  /**
   * 正在进行的那一次强制展示：它排下的全部后续，以及落场那一段自己拿的锁的编号。
   *
   * 按「一次演出一个对象」记而不是记成一串共享的排程，是因为两次展示会重叠：
   * 上一次的闸门在遮罩淡完就放开了，而它的落场飞行和落地特效还要再演一秒多。
   * 共享一串的话，强行收掉第二次展示会把第一次那段还没跑完的收尾一起掐掉，
   * 它那把锁就再没人放了。
   */
  revealRun: ShowcaseRun | null

  // ---------- 演出锁（locks.ts） ----------
  landing: boolean
  landingToken: number
  lockFallback: ScheduledTask | null
  /**
   * 我方出牌时拿的那把锁的编号，等着对面把事件送回来接手。
   * 事件回来时接过它继续用，而不是再上一把——中间隔着的是同一段「这张牌正在飞」。
   */
  playLockToken: number | null

  // ---------- 发牌闸门（deal.ts） ----------
  dealHeld: boolean
  dealBusy: boolean
  dealHoldFallback: ScheduledTask | null
  roundDealFallback: ScheduledTask | null
  /** 正在飞的那一批牌什么时候落地。又起一批时要先掐掉它，否则旧的到点会提前报「发完了」。 */
  dealBusyTask: ScheduledTask | null
  /** 憋着还没飞的牌各有几张，放行时一次性发出去。 */
  pendingDeal: { self: number; opponent: number }
  /** 上一次算出来的「发牌还没演完」，用来认下降沿发 `deal-done`。 */
  dealingBefore: boolean

  // ---------- 回合结算层（settleTimeline.ts） ----------
  settle: SettleState | null

  // ---------- 交互态（director.ts） ----------
  /** 指令发出去了、结果还没回来。下一批事件到达时清掉。 */
  awaiting: boolean
  /** 正在给一张技能牌或英雄技能选目标。 */
  targeting: boolean
  /** 教程要求先完成别的操作，「结束出牌」这一步还不许点。 */
  tutorialEndPlayBlocked: boolean

  // ---------- 局面 ----------
  /** 最近一批事件带来的视图；第一批之前是 null（还没连上）。 */
  view: PlayerView | null
  /** 对局中断过。中断是一次性的，不会再回到 playing。 */
  aborted: boolean
}

export function createContext(seat: PlayerId, rng: Rng): DirectorContext {
  const tasks: Task[] = []
  const cues: Cue[] = []
  let seq = 0

  /** 找出不晚于 `limit` 的下一件事：先比时刻，同刻比登记顺序。 */
  const nextTask = (limit: number): Task | null => {
    let best: Task | null = null
    for (const task of tasks) {
      if (task.canceled || task.at > limit) continue
      if (best === null || task.at < best.at || (task.at === best.at && task.seq < best.seq)) {
        best = task
      }
    }
    return best
  }

  const context: DirectorContext = {
    seat,
    rng,
    now: 0,

    emit(spec) {
      cues.push({ ...spec, at: context.now } as Cue)
    },

    schedule(delayMs, run) {
      seq += 1
      const task: Task = { at: context.now + delayMs, seq, run, canceled: false }
      tasks.push(task)
      return {
        at: task.at,
        cancel() {
          task.canceled = true
        },
      }
    },

    advance(ms) {
      const target = context.now + ms
      for (;;) {
        const task = nextTask(target)
        if (task === null) break
        // 时钟只往前走：排程可能是过去某一刻到期的（延迟被跨过），那时保持当前时刻。
        context.now = Math.max(context.now, task.at)
        task.canceled = true
        task.run()
      }
      context.now = target
      // 跑完一轮把作废的排程清掉，免得数组无限长。
      for (let i = tasks.length - 1; i >= 0; i -= 1) {
        if (tasks[i]!.canceled) tasks.splice(i, 1)
      }
    },

    drain() {
      // `now` 在 advance 里单调不减，emit 又只用当前时刻，所以插入顺序本来就是升序，
      // 这里不排序——排序会打乱同一刻上「谁先谁后」这条信息，而那正是快照要看的东西。
      const taken = cues.slice()
      cues.length = 0
      return taken
    },

    cancelAll() {
      for (const task of tasks) task.canceled = true
      tasks.length = 0
    },

    coinUp: false,
    quizUp: false,
    cancelUp: false,
    revealBusy: false,
    skillShowBusy: 0,

    bannerQueue: [],
    bannerBusy: false,
    pendingCancel: null,

    inspecting: null,
    inspectHeld: false,
    inspectFlying: false,
    revealRun: null,

    landing: false,
    landingToken: 0,
    lockFallback: null,
    playLockToken: null,

    // 开局的手牌默认憋着，等抛硬币过场收尾才放行（旧版 dealHeld 的初值也是 true）。
    dealHeld: true,
    dealBusy: false,
    dealHoldFallback: null,
    roundDealFallback: null,
    dealBusyTask: null,
    pendingDeal: { self: 0, opponent: 0 },
    dealingBefore: true,

    settle: null,

    awaiting: false,
    targeting: false,
    tutorialEndPlayBlocked: false,

    view: null,
    aborted: false,
  }

  return context
}
