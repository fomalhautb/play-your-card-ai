/**
 * 房间页场景对外的契约：入参、要摆的那份状态、能发出的操作、句柄。
 *
 * 单独成文件的理由和 duelContract.ts 一样——它是**跨包的约定**：
 * 装配层（`packages/client/src/screens/RoomScreen.tsx`）按这组类型调用，
 * 组件目录页的条目也按它摆。放在实现文件里的话，每次动实现都要在一堆内部细节里
 * 把这几个 interface 翻出来确认没动到约定。
 *
 * ## 场景是哑的
 *
 * 它只认识 `RoomView` 这一份**已经翻译好的**状态：显示哪一行中文、哪几颗钮该摆出来，
 * 全由装配层决定。场景不认识大厅、房间码从哪来、对方是不是掉线了——
 * 那些是协议和网络的事，混进来就会变成第二个「什么都知道」的巨型组件（旧版的 RoomScreen
 * 就是这么长到 737 行的）。
 *
 * 这一版是**最小可用**：三颗钮、一块码、一行状态、一颗准备。匹配房那张 1199×325 的
 * 图片底板和「复制房间码」「新手教学」那几颗（需求单的面板 L、按钮 G / H）是美术资源，
 * 等第 33 条把素材搬进来再补。
 */

import type { Platform } from '@ai-duel/platform'

/** 这一页现在在干什么。它只决定摆哪一组按钮，不决定文案。 */
export type RoomPhase =
  /** 什么都没开始：摆「匹配 / 开房 / 加入」三颗。 */
  | 'idle'
  /** 正在等服务端答复（排队、开房、按码进房）：只摆一颗「取消」。 */
  | 'busy'
  /** 已经在房里：摆房间码、对方状态、「准备」和「离开」。 */
  | 'room'

/** 「准备」钮的三档。`'done'` 是已经点过——钮还在，但灰着并改了字。 */
export type RoomReady = 'hidden' | 'idle' | 'done'

export interface RoomView {
  /** 账号名，「游客 3f2a」这种。还没开出号来是 null，那一行就空着。 */
  account: string | null
  phase: RoomPhase
  /** 中间那一行状态字（「正在匹配…」「等对方进房…」）。null 就不显示。 */
  status: string | null
  /** 四位房间码。null 就不摆那块大字。 */
  code: string | null
  ready: RoomReady
  /** 要弹出来的一句提示（进不去、码不对、掉线了）。null 就不弹。 */
  notice: string | null
}

/** 玩家在这一页上能做的事。装配层收到之后自己决定怎么办。 */
export type RoomAction =
  /** 排队匹配。 */
  | { kind: 'match' }
  /** 开一个私人房。 */
  | { kind: 'create' }
  /**
   * 想按码进房。**不带码**：四位数字要一个输入框，而画布上不做文字输入
   *（输入法、选区、无障碍全是 DOM 才有的东西）。装配层收到它之后在画布上面盖一个
   * React 的 `CodeInput`，拿到码再自己去连（见 client 的 RoomScreen）。
   */
  | { kind: 'join' }
  /** 我准备好了。 */
  | { kind: 'ready' }
  /** 取消正在等的那次请求。 */
  | { kind: 'cancel' }
  /** 离开房间，回上一页。 */
  | { kind: 'leave' }

export interface RoomSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3）。 */
  resolution: number
  /**
   * 触感和音效。只要这两样——房间页不碰网络、存储、全屏。
   * 不给就静音、不震动（目录页就是这么跑的）。
   */
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /** true 时不注册任何真实时间源，只靠 step() 推进。目录页拍图那一档用它。 */
  manualClock?: boolean
}

export interface RoomScene {
  /** 摆一份状态。同一份摆两次不会重建（见实现里的比较）。 */
  setView(view: RoomView): void
  /** 玩家按了某颗钮。全局只有一个回调，后设的顶掉前一个。 */
  onAction(callback: (action: RoomAction) => void): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /** 没有动画在跑；此时帧循环必须停（3.6）。 */
  isIdle(): boolean
  /** 视口变了，整块重新居中。 */
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的。 */
  destroy(): void
}
