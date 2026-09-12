/**
 * 对局演出编排层的入口（《正式版架构》6.5、迁移第 16 条）。
 *
 * 它是一台**时间驱动的状态机**：一头喂驱动产出的事件批和玩家操作，一头吐演出指令（cue）。
 * 不碰 Pixi、不碰 GSAP、不碰 DOM、不碰平台能力——所以它能用假时钟一步步测，
 * 而这一层正是旧版最测不动的地方（旧版零测试，全部逻辑长在一个 3950 行的 React 组件里）。
 *
 * 用法：
 * ```ts
 * const director = createDirector({ seat, rng: new Rng(seed) })
 * director.push({ events, view })   // 驱动一次 execute 的产出
 * director.advance(16)              // 推进虚拟时钟
 * for (const cue of director.drain()) renderer.play(cue)
 * ```
 *
 * 渲染器**不回调**编排层：每条 cue 自带 `durationMs`，后续该发生什么由编排层自己排期。
 * 时钟推多少由调用方决定（真机上按帧喂，测试里按需要跳），编排层不认识真实时间。
 */

import type { GameEvent, InstanceId, PlayerId, PlayerView } from '@ai-duel/core'
import type { Rng } from '../runtime/rng'
import { createContext } from './context'
import type { Cue } from './cues'
import { armOpeningDealFallback, isDealing, resetDeal } from './deal'
import { handleBatch } from './events'
import { acquirePlayLanding, releaseLanding } from './locks'
import { abortInspect, abortReveal, closeInspect, openInspect } from './reveal'
import { confirmSettle } from './settleTimeline'
import { URGE_BUBBLE_MS } from './timings'

/** 手牌为什么出不了牌。它不挡操作（那归 `actionsLocked`），只决定灰墨态和点上去弹哪句提示。 */
export type HandLockReason = 'foe-turn' | 'quiz' | 'deal'

/**
 * 从编排状态派生出来的一组锁，界面照着它决定什么点得动、什么灰着。
 * 逐条对应旧版 `MatchStage.tsx:2077-2180` 那八个派生量，多出来的只有结算层的确认按钮。
 */
export interface DirectorLocks {
  /** 展示层演着（强制展示或放大查看）：屏幕上有遮罩，什么都不该点得动。 */
  showcasing: boolean
  /** 发牌还没演完：牌压在卡堆上等放行，或者已经在飞。 */
  dealing: boolean
  /** 出牌和「结束出牌」的统一口径。它同时喂给手牌的 disabled。 */
  actionsLocked: boolean
  /** 「结束出牌」比手牌多一道教程的闸，所以单列一条。 */
  endPlayLocked: boolean
  /** 手牌彻底冻住（连 hover 都不接）。比 actionsLocked 窄一截，见旧版 handFrozen 的注释。 */
  handFrozen: boolean
  /** 轮到对方出牌。回合牌匾和手牌灰墨态只认它，不认那些瞬态锁。 */
  waitingForFoe: boolean
  /** 答题和随后的回合结算：这两段双方都出不了牌。 */
  quizWait: boolean
  /** 交给手牌的「为什么出不了牌」，null 表示没锁。 */
  handLockReason: HandLockReason | null
  /** 结算层的确认按钮点不点得动（按钮淡入落地之后、玩家点过之前）。 */
  settleReady: boolean
}

/** 玩家在界面上做的事。它们不产生指令，指令由调用方自己发；这里只管演出和锁。 */
export type UserAction =
  /**
   * 打出一张手牌（拖出去松手、或者点完目标确认）。起飞点这时是已知的。
   * 演出锁在这一刻就上，等事件回来接手；等不到就由兜底放开（见 locks.ts）。
   */
  | { kind: 'play-card'; instanceId: InstanceId; targetInstanceId?: InstanceId }
  /** 点了「结束出牌」。 */
  | { kind: 'end-play' }
  /** 发动主动英雄技能。演出跟着 `HERO_SKILL_USED` 走，这里只记「在等回包」。 */
  | { kind: 'use-hero-skill'; targetInstanceId: InstanceId }
  /** 开始给一张技能牌或英雄技能选目标：战场亮出合法目标，手牌一并冻住。 */
  | { kind: 'targeting-begin' }
  /** 取消选目标。 */
  | { kind: 'targeting-cancel' }
  /** 点开一张卡放大查看（战场小卡或侧栏英雄牌）。 */
  | { kind: 'inspect-open'; source: 'tile' | 'hero'; flipId: string }
  /** 点遮罩关掉放大查看，卡飞回原位。 */
  | { kind: 'inspect-close' }
  /** 结算层点确认。 */
  | { kind: 'settle-confirm' }
  /**
   * 收到一句「催一催」的喊话。
   * 本端点的和对面发来的走同一条路（驱动自己也会回调回来），两台机器上弹的是同一句。
   */
  | { kind: 'urge'; lineId: string }
  /** 教程改了「结束出牌」这一步许不许点。教程状态机本身还没迁（迁移第 32 条）。 */
  | { kind: 'tutorial-gate'; endPlayBlocked: boolean }

export interface Director {
  /** 喂一批事件和它之后的视图，也就是驱动一次 execute 的产出。 */
  push(batch: { events: GameEvent[]; view: PlayerView }): void
  /** 喂一次玩家操作。返回 false 表示这一下没被受理（比如展示层正演着，放大查看开不了）。 */
  userAction(action: UserAction): boolean
  /** 推进虚拟时钟，到期的排程在这里触发。 */
  advance(ms: number): void
  /** 取走自上次以来新产生的 cue，按 `at` 升序。 */
  drain(): Cue[]
  /** 当前这组派生锁。 */
  locks(): DirectorLocks
  /**
   * 排下的期都跑完了：再推时钟也不会自己冒出新的 cue。
   *
   * 调用方判断「这一段演完了没有」时**必须**把它算进去，光看渲染器空没空是不够的：
   * 一段演出的收尾（放锁、接下一条横幅、落场后的特效）是编排层按虚拟时刻排的，
   * 而画面可能早就静止了——低效果档不播落地亮环就是这种情况，
   * 那时渲染器已经闲下来，编排层还差最后一条 cue 没发。
   */
  isIdle(): boolean
  /** 对局中断（对手断线）的一次性清场。 */
  abort(): void
}

export function createDirector(options: { seat: PlayerId; rng: Rng }): Director {
  const context = createContext(options.seat, options.rng)
  // 这一局要是根本没有 GAME_STARTED（联机客人接手一局打到一半的对局），
  // 抛硬币的收尾就永远不会来，开局手牌得有别的路放出去。
  armOpeningDealFallback(context)

  return {
    push(batch) {
      if (context.aborted) return
      // 局面一变就说明上一条指令有结果了（成功或被拒都会换一份新视图）。
      context.awaiting = false
      handleBatch(context, batch.events, batch.view)
    },

    userAction(action) {
      if (context.aborted) return false
      switch (action.kind) {
        case 'play-card':
          context.awaiting = true
          context.targeting = false
          context.playLockToken = acquirePlayLanding(context)
          return true
        case 'end-play':
          context.awaiting = true
          return true
        case 'use-hero-skill':
          context.awaiting = true
          context.targeting = false
          return true
        case 'targeting-begin':
          context.targeting = true
          return true
        case 'targeting-cancel':
          context.targeting = false
          return true
        case 'inspect-open':
          return openInspect(context, { source: action.source, flipId: action.flipId })
        case 'inspect-close':
          return closeInspect(context)
        case 'settle-confirm': {
          if (!confirmSettle(context)) return false
          context.awaiting = true
          return true
        }
        case 'urge':
          context.emit({ kind: 'urge', durationMs: URGE_BUBBLE_MS, lineId: action.lineId })
          return true
        case 'tutorial-gate':
          context.tutorialEndPlayBlocked = action.endPlayBlocked
          return true
      }
    },

    advance(ms) {
      context.advance(ms)
    },

    drain() {
      return context.drain()
    },

    isIdle() {
      return !context.pending()
    },

    locks() {
      const view = context.view
      // 没收到过第一批事件（还在连）、中断了、打完了，都不是「正在打」。
      const playing = view !== null && !context.aborted && view.phase !== 'finished'
      const myPlayTurn =
        view !== null && view.phase === 'play' && view.activePlayer === context.seat
      const showcasing = context.revealBusy || context.inspecting !== null
      const dealing = isDealing(context)
      const actionsLocked =
        !myPlayTurn ||
        !playing ||
        context.awaiting ||
        showcasing ||
        context.landing ||
        context.targeting ||
        dealing
      const waitingForFoe = playing && view.phase === 'play' && !myPlayTurn
      const quizWait = playing && (view.phase === 'quiz' || view.phase === 'settle')
      return {
        showcasing,
        dealing,
        actionsLocked,
        endPlayLocked: actionsLocked || context.tutorialEndPlayBlocked,
        // 刻意比 actionsLocked 窄：不是我的回合、在等回包这些「只是出不了牌」的时刻，
        // 玩家仍然应该能把牌抬起来看清楚。
        handFrozen: context.landing || showcasing || context.targeting,
        waitingForFoe,
        quizWait,
        // 前两档优先：发牌和「轮到对方 / 在答题」撞上时，玩家更该知道的是后者。
        // 排掉选目标态是为了守住「灰墨态和正在施放不同时出现」这条。
        handLockReason: waitingForFoe
          ? 'foe-turn'
          : quizWait
            ? 'quiz'
            : dealing && !context.targeting
              ? 'deal'
              : null,
        settleReady: context.settle?.ready ?? false,
      }
    },

    /**
     * 对局中断时的一次性清场（旧版 `view.status === 'aborted'` 那个 effect）。
     *
     * 回合结算层要等双方确认才会自己退场，而中断时对面再也不会确认了；
     * 三个全屏过场都是吃指针事件的层，不收掉玩家会被一层退不掉的遮罩挡死。
     * 强制展示会自己走完，但对手都断线了没必要再演，一并收掉。
     */
    abort() {
      if (context.aborted) return
      context.aborted = true
      abortReveal(context)
      abortInspect(context)
      // 剩下的过场层没有各自的收尾可走，统一发一条清场指令。
      context.emit({ kind: 'clear-overlays', durationMs: 0 })
      context.cancelAll()
      context.coinUp = false
      context.quizUp = false
      context.cancelUp = false
      context.revealBusy = false
      context.skillShowBusy = 0
      context.pendingCancel = null
      context.bannerQueue = []
      context.bannerBusy = false
      context.revealRun = null
      context.playLockToken = null
      context.lockFallback = null
      // 无条件强放：这时候锁着的界面没有任何意义，谁拿的都不重要。
      releaseLanding(context)
      resetDeal(context)
      context.settle = null
      context.targeting = false
      context.awaiting = false
    },
  }
}
