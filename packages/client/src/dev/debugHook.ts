/**
 * 开发构建下挂在 `window.__aiDuel` 上的调试口子：读当前这一页的状态，以及代本端发一条指令。
 *
 * 端到端那两条联机用例要它（e2e/online.spec.ts），各要一半：
 *
 * - **房间页只读**（`room`）。房间码画在画布上，用例读不到它——DOM 里根本没有那几个字。
 *   三颗钮仍然是真的用指针点的，点了之后大厅通不通正是这条用例要守的东西。
 * - **新手教程只读**（`tutorial`）。教程那条用例（e2e/tutorial.spec.ts）要知道「现在停在哪一步」
 *   才判得出该做什么，而步骤 id 一个字都不在 DOM 里；要圈的那几块也只有场景答得上来
 *   （画布上没有元素可查）。所以这一格给出「哪一步 + 那几块矩形」，**点还是真的用指针点**。
 * - **对局页还能发指令**（`match`）。两个浏览器打完整局要走八轮，每轮双方各出几张牌、
 *   各确认一次结算，全靠合成指针拖牌的话一条用例要拖上百次，每次都得先算出那张牌
 *   此刻在屏幕哪儿。**拖牌本身已经由单机那条用例守着了**（e2e/localMatch.spec.ts
 *   真的按 pointerdown / move / up 拖），联机这条要守的是别的东西：两端的序号、
 *   重同步、房间成员关系、掉线重连。所以这里给它一条直达 driver 的路。
 *
 * ## 为什么这不是一个作弊口子
 *
 * 1. 整个文件在生产构建里**不存在**——它只被两处 `import.meta.env.DEV` 守着的动态 import
 *    拉进来，那个条件在生产构建里是字面量 false，整段连同这个模块一起被当成死代码删掉
 *    （同 App.tsx 那张开发页表的原理）。
 * 2. 就算有人手工把它编进去也没有用：`send` 只收 `PlayerCommand` 那四种，
 *    而服务端会核对指令里的座位是不是发送方自己的（server 的 commands.ts），
 *    规则本身也仍然在服务端跑。它能做的事和玩家在界面上能做的事完全一样，
 *    只是省掉了「先把牌拖到屏幕上某个位置」这一步。
 */

import type { RoomView } from '@ai-duel/canvas'
import type { PlayerCommand } from '@ai-duel/protocol'
import type { MatchDriver, MatchView } from '../match/driver'

export interface MatchDebug {
  /** 当前这一局的快照。联机时就是服务端裁剪过的那一份，客户端算不出别的。 */
  view(): MatchView
  /** 代本端发一条玩家指令，和在界面上点出来的那条完全一样。 */
  send(command: PlayerCommand): void
}

export interface RoomDebug {
  /** 房间页此刻摆在画布上的那份状态（房间码、状态行、准备钮）。 */
  view(): RoomView
}

/** 一块地方，画布的 CSS 像素坐标。用例照它算「点哪儿」。 */
export interface DebugRect {
  x: number
  y: number
  w: number
  h: number
}

/** 新手教程此刻的样子。三段（组牌 / 选英雄 / 对战）共用同一个形状。 */
export interface TutorialProbe {
  /** 走到哪一段了：`deck` / `hero` / `duel`。 */
  phase: string
  /** 这一段内部的步骤 id（各段各有各的 id 空间）。 */
  step: string
  /** 提示出场了没有。没出场时点什么都不算数（见 tutorial/machine.ts）。 */
  ready: boolean
  /** 这一步要圈的那几块。用例点它们的正中。 */
  targets(): DebugRect[]
  /**
   * 对战那一段的语义锚点（`DuelAnchorName`）。用例要按它找「结束出牌」那颗钮——
   * 它画在画布上，DOM 里没有这颗按钮。别的两段一律返回 null。
   */
  anchor(name: string): DebugRect | null
}

export interface TutorialDebug {
  view(): { phase: string; step: string; ready: boolean }
  targets(): DebugRect[]
  anchor(name: string): DebugRect | null
}

/**
 * 两页各占一格。分成两格而不是一个大对象：两页的生命周期不一样，
 * 用例也要靠「这一格在不在」判断自己现在停在哪一页。
 */
export interface AiDuelDebug {
  match?: MatchDebug
  room?: RoomDebug
  tutorial?: TutorialDebug
}

declare global {
  interface Window {
    /** 只有开发构建挂得上。用例读它之前要自己等它出现。 */
    __aiDuel?: AiDuelDebug
  }
}

/** 往哪一格里放什么，放完返回一个把它摘掉的函数。 */
function install<K extends keyof AiDuelDebug>(key: K, value: AiDuelDebug[K]): () => void {
  window.__aiDuel ??= {}
  const bag = window.__aiDuel
  bag[key] = value
  return () => {
    // 只摘自己放的那一份：页面重挂时新的已经放进去了，照摘会让用例读到 undefined。
    if (bag[key] === value) delete bag[key]
  }
}

/** 对局页那一格。返回摘掉它的函数。 */
export function installMatchDebug(driver: MatchDriver): () => void {
  return install('match', {
    view: () => driver.getSnapshot(),
    send: (command) => driver.send(command),
  })
}

/** 房间页那一格。传的是取值器而不是当时那份状态——这一页每变一次都会换一个新对象。 */
export function installRoomDebug(read: () => RoomView): () => void {
  return install('room', { view: read })
}

/**
 * 新手教程那一格。同样传取值器：教程每推一步就换一份，而这一格只挂一次。
 * 三段各自挂各自的，走到哪一段这里就是哪一段（`phase` 分得出来）。
 */
export function installTutorialDebug(read: () => TutorialProbe): () => void {
  return install('tutorial', {
    view: () => {
      const probe = read()
      return { phase: probe.phase, step: probe.step, ready: probe.ready }
    },
    targets: () => read().targets(),
    anchor: (name) => read().anchor(name),
  })
}
