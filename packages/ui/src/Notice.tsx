/**
 * 提示 E（错误红字）的 React 版（需求单「九、提示」）。
 *
 * 需求单里这一条标的是「**两边都要**」：匹配房 / 组牌 / 对局那三处画在画布上，
 * 正式版的表单校验和页面级提示归 `ui`——这一份就是后者。
 *
 * 三档语气共用一套版式，只换颜色和左边那道竖线：
 * - `error` 错误红（`color.status.error`，纸面和夜色页都用这一档）；
 * - `ok`    成功绿（`color.status.ok`，「已经存好了」这类）；
 * - `info`  次级墨色，说一句不算错的补充（账号页那句「绑定账号还没做」）。
 *
 * 为什么要有 `ok` 和 `info`：需求单只列了红字这一档，但真做出设置页之后，
 * 「重置完成」和「这一项暂时没有」这两句也要有地方说，而它们和错误红显然不是一回事。
 * 版式完全一样，所以是同一个组件的三档语气，不是三个组件（去重记录第 1 条的路子）。
 *
 * `role` 跟着语气走：错误那档用 `alert`（读屏软件会打断当前朗读念出来，
 * 因为它多半是玩家刚做的那一下失败了），其余两档用 `status`（等读完手头的再念）。
 */

import type { ReactNode } from 'react'
import './notice.css'

export type NoticeTone = 'error' | 'ok' | 'info'

export interface NoticeProps {
  children: ReactNode
  /** 默认 `error`：这个组件最常见的用处就是说一句「刚才那步没成」。 */
  tone?: NoticeTone
}

export function Notice({ children, tone = 'error' }: NoticeProps) {
  return (
    <p className="ui-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}
