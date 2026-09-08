/**
 * 剧本和被测场景之间的契约。
 *
 * 真身在 `@ai-duel/canvas` 的 `scenes/duelContract.ts`，这里只是重新导出一遍。
 * bench 里的模块一律从这个文件取类型，好处是「被测场景是谁」只写在这一个地方：
 * 剧本、指标、桩场景都不直接 import canvas。
 *
 * 关键约定是 `manualClock`：为 true 时场景不许注册任何真实时间源（rAF、Pixi 自动 ticker、
 * gsap 内部 ticker 都算），只能靠 `step()` 推进。动作返回的 Promise 因此只会在反复
 * `step()` 到 `isIdle()` 为 true 之后才 resolve，剧本的写法固定是
 * 「发起动作 → while (!isIdle()) step(16.667) → await」。
 */

export type {
  CardTextures,
  DuelPrototype,
  /** 场景自己数的三个计数器，对应 6.9 表里画布内部才知道的那几行。 */
  DuelPrototypeCounters,
  DuelPrototypeOptions,
  /** 效果档位，对应《正式版架构》纪律 3.7。决定分辨率上限、特效开关和粒子数量。 */
  EffectTier,
} from '@ai-duel/canvas'

import type { DuelPrototype, DuelPrototypeOptions } from '@ai-duel/canvas'

/** 建场景的函数签名。真实场景和桩场景都按它实现，benchApi 按 init 的 scene 选一个。 */
export type CreateDuelPrototype = (opts: DuelPrototypeOptions) => Promise<DuelPrototype>
