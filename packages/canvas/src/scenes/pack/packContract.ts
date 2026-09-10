/**
 * 开包场景对外的契约（迁移第 29 条）。
 *
 * ## 这是一个**全新**的界面
 *
 * 旧版没有开包：`drawNewCard` 因为初始收藏正好等于整个卡池，恒返回 null（见 content 的
 * collection.ts），所以那条链路一次都没亮过。这里做的是最小版——卡背居中、点一下翻面、
 * 报一声卡名、一颗「继续」。等卡池真的扩出「还没解锁的牌」之后再往上加。
 *
 * ## 状态由装配层持有
 *
 * 和选英雄页一样是受控的：翻到第几步（还没翻 / 翻开了）由装配层通过 `setView` 摆进来。
 * 场景不认识存档，也不决定「继续」之后去哪——那是 `PackScreen.tsx` 的事。
 */

import type { Platform } from '@ai-duel/platform'
import type { CardVisual } from '../../components/CardSprite'
import type { EffectTier } from '../../fx/effectTier'

/** 这一包开到哪一步了。 */
export type PackPhase =
  /** 卡背居中，等玩家点一下。 */
  | 'closed'
  /** 已经翻开：正面朝上，底下报卡名和「已加入收藏」，摆出「继续」。 */
  | 'opened'

export interface PackView {
  phase: PackPhase
  /** 这一包开出来的那张牌。 */
  card: CardVisual
}

/** 玩家在这一页上能做的事。 */
export type PackAction =
  /** 点了卡背，想翻开。翻面的演出由场景播，装配层收到之后把 phase 改成 `'opened'`。 */
  | { kind: 'flip' }
  /** 按了「继续」。回哪一页由装配层决定。 */
  | { kind: 'continue' }

export interface PackSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3）。 */
  resolution: number
  /** 档位决定命中特效的烟尘数量和那圈亮环。不给就是中档。 */
  tier?: EffectTier
  /** 触感和音效。不给就静音、不震动（目录页就是这么跑的）。 */
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /** true 时不注册任何真实时间源，只靠 step() 推进。 */
  manualClock?: boolean
  /** 指针是不是粗的。它和视口短边一起决定卡放多大。 */
  coarsePointer?: boolean
  /** 特效里的随机（烟尘方向、大小）用它定种子，同 seed 同结果（6.9 的确定性前提）。 */
  seed?: number
}

export interface PackScene {
  /** 摆一份状态。同一份摆两次不会重播翻面。 */
  setView(view: PackView): void
  /** 玩家按了某颗钮。全局只有一个回调，后设的顶掉前一个。 */
  onAction(callback: (action: PackAction) => void): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /** 没有动画在跑；此时帧循环必须停（3.6）。 */
  isIdle(): boolean
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的。 */
  destroy(): void
}
