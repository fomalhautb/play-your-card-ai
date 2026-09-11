/**
 * 把「教程指着哪几处」换算成引导层要的那几块矩形。
 *
 * 三段教学（组牌、选英雄、对战）各有各的锚点类型，但换算这一步是同一件事：
 * 逐个去问场景，问不出来的（场景还没建好、那一档版式根本没有这样东西）整个跳过。
 *
 * 跳过而不是给一块空矩形：引导层看到一个零面积的洞会照样画一圈描边，
 * 玩家会盯着屏幕角落那个小点找半天。
 */

import type { AnchorRect } from '@ai-duel/canvas'
import type { OverlayRect } from '@ai-duel/ui'

/**
 * @param targets 这一步要圈的那几处（各段自己的锚点类型）
 * @param rectOf  去问场景。场景还没建出来时调用方传一个恒返回 undefined 的取值器
 */
export function measureRects<T>(
  targets: readonly T[],
  rectOf: (target: T) => AnchorRect | null | undefined,
): OverlayRect[] {
  const out: OverlayRect[] = []
  for (const target of targets) {
    const rect = rectOf(target)
    if (rect === null || rect === undefined) continue
    out.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })
  }
  return out
}
