/**
 * 弹窗 E（结算遮罩）（需求单「四、弹窗和浮层」）：终局结算那块羊皮纸底下的暗幕。
 *
 * 和弹窗 A（`Dialog`）的遮罩是两回事，所以是两个组件：
 * - 弹窗 A 的遮罩是**可以点掉的**（点它、按 Esc 都等于取消），它挡的是一次可撤销的确认；
 * - 这一层挡的是「这局已经打完了」，点哪儿都不该退——玩家必须从下面那排按钮里挑一条路走。
 *   所以它没有 `onDismiss`，也不监听 Esc。
 *
 * ## `position: absolute` 而不是 `fixed`
 *
 * 它铺的是**对局那一屏**（`.match` 已经是 `position: fixed`），不是整个视口。
 * 用 absolute 之后目录页那条条目也摆得出来：条目外面套一个定尺寸的相对定位盒子就行，
 * 不像 `Dialog` 那样非要一个只给目录页用的 `inline` 开关。
 */

import type { ReactNode } from 'react'
import './veil.css'

export interface VeilProps {
  /** 压在暗幕上的东西，一般是一块 `Sheet`。整层居中。 */
  children: ReactNode
}

export function Veil({ children }: VeilProps) {
  return (
    <div className="ui-veil">
      <div className="ui-veil__content">{children}</div>
    </div>
  )
}
