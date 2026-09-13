/**
 * 开发构建下挂在 `window.__aiDuel` 上的调试口子：读当前这一页的状态，以及代本端发一条指令。
 *
 * 端到端那两条联机用例要它（e2e/online.spec.ts），各要一半：
 *
 * - **房间页只读**（`room`）。房间码画在画布上，用例读不到它——DOM 里根本没有那几个字。
 *   三颗钮仍然是真的用指针点的，点了之后大厅通不通正是这条用例要守的东西。
 * - **对局页还能发指令**（`match`）。两个浏览器打完整局要走八轮，每轮双方各出几张牌、
 *   各确认一次结算，全靠合成指针拖牌的话一条用例要拖上百次，每次都得先算出那张牌
 *   此刻在屏幕哪儿。**拖牌本身已经由单机那条用例守着了**（e2e/localMatch.spec.ts
 *   真的按 pointerdown / move / up 拖），联机这条要守的是别的东西：两端的序号、
 *   重同步、房间成员关系、掉线重连。所以这里给它一条直达 driver 的路。
 * - **画布上的东西按坐标反查**（`stage`）。单机那条用例要真的拖一张牌出去，
 *   而卡在屏幕上的位置由版式、扇形几何和这一刻的动画共同决定，Node 那边算不出来。
 *   这一格把 `@ai-duel/canvas` 的 `installHitProbe()` 转出去：按 label 找到对象、
 *   用 Pixi 自己的命中测试验一遍坐标。实现只有一份，bench 的交互用例读的也是它。
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

import { type HitBox, type HitPoint, installHitProbe, type RoomView } from '@ai-duel/canvas'
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

/** 画布上的东西在屏幕的哪儿。三个方法都是 `installHitProbe()` 的原样转出。 */
export interface StageDebug {
  /**
   * label 以 `prefix` 开头、此刻真点得到的那些对象，各给一个视口坐标。
   * `within` 限定「只要这个 label 底下的」——手牌和战场上的卡 label 同前缀，靠它分开。
   */
  points(prefix: string, within?: string): HitPoint[]
  /** 这个视口坐标点下去会命中谁（返回 label），点空返回 null。 */
  labelAt(x: number, y: number): string | null
  /** label 正好等于这个的那个对象在屏幕上占的矩形。不做命中验证，给不吃指针的容器用。 */
  box(label: string): HitBox | null
}

/**
 * 两页各占一格。分成两格而不是一个大对象：两页的生命周期不一样，
 * 用例也要靠「这一格在不在」判断自己现在停在哪一页。
 */
export interface AiDuelDebug {
  match?: MatchDebug
  room?: RoomDebug
  stage?: StageDebug
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
 * 画布那一格。和上面两格不一样，它**不跟着某一页的生命周期走**：
 * 探针是包在 `WebGLRenderer.prototype.render` 上的一层，装一次就一直在，
 * 问的永远是「最后一次画到屏幕上的那棵树」。所以它不返回摘掉自己的函数。
 *
 * 必须在**建场景之前**装好：帧循环在没有动画时会停（纪律 3.6），晚装的话可能一直等不到下一帧。
 * 调用方是 MatchScreen 那个 `import.meta.env.DEV` 守着的动态 import——它在挂载时就跑，
 * 而场景要等卡面图集下完才建得起来，早了好几百毫秒。
 */
export function installStageDebug(): void {
  const probe = installHitProbe()
  window.__aiDuel ??= {}
  window.__aiDuel.stage = {
    points: (prefix, within) => probe.pointsOf(prefix, within),
    labelAt: (x, y) => probe.labelAt(x, y),
    box: (label) => probe.boxOf(label),
  }
}
