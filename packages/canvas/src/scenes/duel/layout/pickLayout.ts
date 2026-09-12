/**
 * 挑一档版式。
 *
 * 两个判据，任一成立就走手机档：
 * 1. **指针是粗的**（`coarsePointer`，也就是 CSS 的 `pointer: coarse`）。手指点不准，
 *    要更大的热区和更高的手牌区，这和屏幕多大无关——大屏平板照样是手指在点。
 * 2. **视口短边窄于断点**。看短边不看宽：手机横过来是 844×390，宽度过了断点但高只有 390，
 *    竖着排的顶栏、战场、手牌区照样挤不下。
 *
 * 判据在这里而不是在两个版式文件里，是为了让「选哪一档」单独测得了：
 * 版式本身只回答「这一档怎么摆」，不回答「什么时候用这一档」。
 */

import { desktopLayout } from './desktopLayout'
import { mobileLayout } from './mobileLayout'
import type { DuelLayout, LayoutTier } from './types'

/** 视口短边窄于它就按触屏档排版。和旧样式里那条移动端媒体查询同一个断点。 */
export const TOUCH_BREAKPOINT = 768

export function pickTier(width: number, height: number, coarsePointer = false): LayoutTier {
  if (coarsePointer) return 'mobile'
  return Math.min(width, height) < TOUCH_BREAKPOINT ? 'mobile' : 'desktop'
}

export function pickLayout(width: number, height: number, coarsePointer = false): DuelLayout {
  return pickTier(width, height, coarsePointer) === 'mobile'
    ? mobileLayout(width, height)
    : desktopLayout(width, height)
}
