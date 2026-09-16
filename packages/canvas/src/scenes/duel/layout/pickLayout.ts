/**
 * 挑一档版式。
 *
 * 两个判据，任一成立就走手机档：
 * 1. **指针是粗的**（`coarsePointer`，也就是 CSS 的 `pointer: coarse`）。手指点不准，
 *    要更大的热区和更高的手牌区，这和屏幕多大无关——大屏平板照样是手指在点。
 * 2. **视口宽度窄于断点**。竖排的顶栏、战场、手牌区挤不挤得下由**宽**决定：
 *    侧栏 306 加战场一排五格是横向的预算，窄屏才要把侧栏折叠掉。
 *
 * 看宽不看短边，是 2026-09-16 修「电脑上打不出牌」时改的。原先看的是短边，为的是
 * 「手机横过来 844×390，宽度过了断点但高只有 390」那一档；可是横过来的手机本来就是**粗指针**，
 * 第 1 条已经把它收走了，短边这条只剩下一个后果：把窗口拉矮（或者屏幕本来就矮）的鼠标电脑
 * 判进手机档。而手机档是**不缩放**的（见 mobileLayout 的文件头），顶栏加面板行加对手手牌条
 * 加手牌区在矮视口上会把战场挤没，于是牌拖上去也没有落点，看着就是「打不出牌」。
 *
 * 判据在这里而不是在两个版式文件里，是为了让「选哪一档」单独测得了：
 * 版式本身只回答「这一档怎么摆」，不回答「什么时候用这一档」。
 */

import { desktopLayout } from './desktopLayout'
import { mobileLayout } from './mobileLayout'
import type { DuelLayout, LayoutTier } from './types'

/** 视口宽度窄于它就按触屏档排版。和旧样式里那条移动端媒体查询同一个断点。 */
export const TOUCH_BREAKPOINT = 768

export function pickTier(width: number, coarsePointer = false): LayoutTier {
  if (coarsePointer) return 'mobile'
  return width < TOUCH_BREAKPOINT ? 'mobile' : 'desktop'
}

export function pickLayout(width: number, height: number, coarsePointer = false): DuelLayout {
  return pickTier(width, coarsePointer) === 'mobile'
    ? mobileLayout(width, height)
    : desktopLayout(width, height)
}
