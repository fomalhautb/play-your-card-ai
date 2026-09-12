/**
 * MatchDriver：对局界面和「规则跑在哪」之间的唯一接口。
 *
 * 只有两个实现（《正式版架构》5.6）：`localDriver`（单机、教程，规则在本地跑）
 * 和 `serverDriver`（联机，规则在房间 Durable Object 里跑）。旧版那套房主 / 客人
 * 各一个实现已经废弃——权威服务端之后没有「房主替大家跑规则」这回事了。
 *
 * 界面因此不知道自己是在单机还是在联机，接哪一个都是同一套屏幕代码。
 *
 * ## 局面和事件为什么分两条路出去
 *
 * `getSnapshot()` 给的是**结果**（这批事件全部应用完之后的局面），界面照它渲染；
 * `subscribeEvents()` 给的是**过程**（一批一批的事件），演出编排层照它播动画。
 * 两者节奏不同：动画要按时间铺开演几秒，而局面在收到那一刻就已经是最新的。
 * 混成一条的话，要么动画拖住渲染，要么渲染抢在动画前面把结果剧透了。
 */

import type { GameEvent, PlayerId, PlayerView } from '@ai-duel/core'
import type { PlayerCommand } from '@ai-duel/protocol'

export type MatchStatus =
  /** 还没拿到局面：正在连服务端，或者对手还没就绪。 */
  | 'connecting'
  | 'playing'
  /** 分出胜负了。 */
  | 'finished'
  /** 对局中断（对手退出、房间超时、进不去房间），和 finished 不一样，没有赢家。 */
  | 'aborted'

/**
 * 联机链路的通断。
 *
 * `'down'` 不代表对局结束，只代表此刻消息送不到服务端——网络抖动、切网、锁屏都会这样。
 * 界面据此显示「正在重连」，让玩家知道自己在等什么。
 *
 * 只在 `status` 还是 `'playing'` 或 `'connecting'` 时才该拿它提示重连：
 * 对局一旦走到 `finished` / `aborted`，连接是**故意**关掉的（收到 `room:closed`
 * 或 `session:rejected` 之后不许再重连），这时的 `'down'` 是正常收场，不是故障。
 *
 * 单机玩法没有链路可言，恒为 `'ok'`。
 */
export type MatchLink = 'ok' | 'down'

/** 对手此刻的状态。开局之后三项都是 true，界面主要在房间页用它。 */
export interface PeerState {
  /** 对手此刻有没有连着。false 不代表他走了——可能正在重连。 */
  online: boolean
  /** 对手报过牌组和英雄了没有。 */
  loaded: boolean
  /** 对手点过「准备好了」没有。 */
  ready: boolean
}

/**
 * 一批要播的事件，加上这批之后的局面。
 *
 * 两样一起给而不是分两次回调：演出编排层每收一批都要拿新局面对账
 *（客户端不许自己按事件推算局面，见需求第 6 条），分开就得自己配对。
 *
 * 形状和 `canvas` 的 `Director.push()` 入参一致，接起来是一行。
 */
export interface MatchEventBatch {
  events: GameEvent[]
  view: PlayerView
}

export interface MatchView {
  /**
   * 当前这一方能看到的局面。联机时是服务端 `viewFor` 裁剪过的那一份，不是自己算的。
   *
   * 拿到第一份之前是 null：联机要等 `match:started` 或重连的 `match:snapshot`。
   */
  view: PlayerView | null
  /** 本端占的座位号，决定界面把哪边画成「我方」。握手拿到之前是 null。 */
  seat: PlayerId | null
  status: MatchStatus
  /**
   * 最近一条指令被拒绝的原因，下一批事件到达时自动清空。
   * 界面拿它显示提示；正常玩不该看到它，看到就说明界面和引擎的判断不一致。
   */
  lastRejection: string | null
  /** status 为 aborted 时的原因，可以直接显示给玩家。 */
  abortReason: string | null
  /** 联机链路通不通。单机玩法恒为 'ok'。 */
  link: MatchLink
  /** 对手状态。单机玩法和还没收到过 `room:peer` 时是 null。 */
  peer: PeerState | null
}

export interface MatchDriver {
  /** 局面变了就回调，配 React 的 useSyncExternalStore 用。 */
  subscribe(listener: () => void): () => void
  /** 无变化时必须返回同一个对象引用，否则 useSyncExternalStore 会一直重渲染。 */
  getSnapshot(): MatchView
  /**
   * 每产生一批新事件回调一次，给演出编排层用。
   *
   * **全局只允许一个订阅者**，换来的是「没人订阅时攒着、第一个订阅者来了补发」
   * ——开局那批事件在界面挂上来之前就到了，不攒着发牌动画必然丢（见 driverCore.ts）。
   */
  subscribeEvents(listener: (batch: MatchEventBatch) => void): () => void
  /**
   * 发一条玩家指令。
   *
   * 只收 `PlayerCommand` 那四种：`SUBMIT_ANSWERS` 由服务端自己发，`DEBUG_*` 联机时
   * 谁都不能发（见 protocol 的 command.ts）。单机 driver 要跑调试指令的话另开一个方法，
   * 别把这条口子放宽——放宽了作弊防线就只剩服务端一道。
   */
  send(command: PlayerCommand): void
  /**
   * 「催一催」：本端喊一句，同步给对面，两边一起放录音、弹气泡。
   *
   * 不走 send：它不是指令，引擎不认识它，也不该进局面。
   */
  urge(id: string): void
  /** 订阅喊话（本端和对面的都会到）。可以有多个订阅者，也没有补发缓冲——见 driverCore.ts。 */
  subscribeUrge(listener: (id: string) => void): () => void
  /** 界面卸载时调用：断连接、清定时器。 */
  dispose(): void
}
