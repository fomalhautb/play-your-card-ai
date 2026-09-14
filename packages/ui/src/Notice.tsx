/**
 * 一行提示。表单校验没过、某件事做成了、某件事暂时没有，都用它说一句。
 *
 * 三档语气只剩一个作用：决定读屏软件怎么念。错误那档用 `alert`（会打断当前朗读，
 * 因为它多半是玩家刚做的那一下失败了），其余两档用 `status`（等读完手头的再念）。
 * 从前三档还各有一套颜色和左边一道竖线，正式版简化第 3 步剥掉了。
 */

import type { ReactNode } from 'react'

export type NoticeTone = 'error' | 'ok' | 'info'

export interface NoticeProps {
  children: ReactNode
  /** 默认 `error`：这个组件最常见的用处就是说一句「刚才那步没成」。 */
  tone?: NoticeTone
}

export function Notice({ children, tone = 'error' }: NoticeProps) {
  return <p role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}
