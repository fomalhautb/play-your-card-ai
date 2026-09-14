/**
 * 一层铺满的暗幕，中间托着调用方给的东西（终局结算那块板）。
 *
 * 和 `Dialog` 的遮罩是两回事，所以是两个组件：对话框的遮罩点一下等于取消，
 * 这一层挡的是「这局已经打完了」，点哪儿都不该退——玩家必须从下面那排按钮里挑一条路走。
 * 所以它没有 `onDismiss`，也不监听 Esc。
 *
 * `position: absolute` 而不是 `fixed`：它铺的是**对局那一屏**（`.match` 已经是 fixed），
 * 不是整个视口。用 absolute 之后目录页那条条目也摆得出来。
 */

import type { ReactNode } from 'react'
import './veil.css'

export interface VeilProps {
  /** 压在暗幕上的东西，一般是一块 `Sheet`。整层居中。 */
  children: ReactNode
}

export function Veil({ children }: VeilProps) {
  return <div className="ui-veil">{children}</div>
}
