/**
 * 桩场景的版式和档位参数。
 *
 * 数值只求「像一副手牌、够触发各条计数器」，不追求和旧客户端一致——
 * 真实场景（迁移第 1 条）合并进来之后这个文件就没人用了。
 */

import type { EffectTier } from './contract'

export interface Slot {
  x: number
  y: number
  rotation: number
}

/** 一档效果开多少东西。纪律 3.7：档位决定特效开关和粒子数量。 */
export interface TierConfig {
  particles: number
  /** 高档在命中时多铺一层全屏叠加发光。纪律 3.2 盯的就是这类层数。 */
  fullscreenGlow: boolean
}

export const TIERS: Readonly<Record<EffectTier, TierConfig>> = {
  low: { particles: 4, fullscreenGlow: false },
  mid: { particles: 10, fullscreenGlow: false },
  high: { particles: 20, fullscreenGlow: true },
}

/** 手牌扇形：以屏幕底部外侧一点为圆心张开，和旧客户端的手感一致。 */
export function fanSlot(index: number, count: number, width: number, height: number): Slot {
  const spread = Math.min(0.14, 1.0 / Math.max(count, 1))
  const centered = index - (count - 1) / 2
  const angle = centered * spread
  const radius = height * 0.9
  return {
    x: width / 2 + Math.sin(angle) * radius,
    y: height * 0.98 - Math.cos(angle) * radius + radius,
    rotation: angle,
  }
}

/** 打出去的牌在桌面上排一行。 */
export function boardSlot(index: number, width: number, height: number): Slot {
  const columns = 5
  const col = index % columns
  const row = Math.floor(index / columns)
  return {
    x: width / 2 + (col - (columns - 1) / 2) * width * 0.11,
    y: height * 0.34 + row * height * 0.19,
    rotation: 0,
  }
}

/** 发牌的起点：牌库在右下角外面一点。 */
export function deckAnchor(width: number, height: number): Slot {
  return { x: width * 0.94, y: height * 1.1, rotation: 0.2 }
}
