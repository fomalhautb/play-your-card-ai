/**
 * 剧本和被测场景之间的契约。
 *
 * 这份契约由 `canvas` 包实现（迁移第 1 条的对局原型），bench 只负责驱动它。
 * 现在 `canvas` 还是空骨架，所以类型先写在这里、由 stubScene.ts 的桩场景实现；
 * 等真实场景合并进来，把这里换成 `import type { ... } from '@ai-duel/canvas'`，
 * 名字和语义一个都不要改——改了两边就对不上。
 *
 * 关键约定是 `manualClock`：为 true 时场景不许注册任何真实时间源（rAF、Pixi 自动 ticker、
 * gsap 内部 ticker 都算），只能靠 `step()` 推进。动作返回的 Promise 因此只会在反复
 * `step()` 到 `isIdle()` 为 true 之后才 resolve，剧本的写法固定是
 * 「发起动作 → while (!isIdle()) step(16.667) → await」。
 */

import type { Texture } from 'pixi.js'

/** 效果档位，对应《正式版架构》纪律 3.7。决定分辨率上限、特效开关和粒子数量。 */
export type EffectTier = 'low' | 'mid' | 'high'

/** 一局用到的全部纹理。`faces` 的 key 就是 `deck` 里的元素。 */
export interface CardTextures {
  faces: Record<string, Texture>
  back: Texture
}

export interface DuelPrototypeOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。真正的帧缓冲尺寸是它乘以 `resolution`。 */
  width: number
  height: number
  /** 渲染倍率，纪律 3.3 封顶 1.5。 */
  resolution: number
  tier: EffectTier
  /** 同 seed 同结果：粒子抖动这类随机量都从它派生。 */
  seed: number
  textures: CardTextures
  /** 牌库顺序，元素是 `textures.faces` 的 key。 */
  deck: string[]
  /** true 时不注册任何真实时间源，只靠 `step()` 推进。 */
  manualClock: boolean
}

/** 场景自己数的三个计数器，对应 6.9 表里画布内部才知道的那几行。 */
export interface SceneCounters {
  /** 文字对象创建次数。动画期间必须不增长（纪律 3.5）。 */
  textCreated: number
  /** 真正调用 renderer.render 的次数。空闲时必须不增长（纪律 3.6）。 */
  renders: number
  /** 场景主动要下一帧的次数（rAF 或自动 ticker 回调）。manualClock 下恒为 0。 */
  frameRequests: number
}

export interface DuelPrototype {
  deal(count: number): Promise<void>
  playCard(handIndex: number): Promise<void>
  flip(handIndex: number): Promise<void>
  hover(handIndex: number | null): void
  /** 手动推进一帧：gsap.updateRoot + Pixi ticker.update + 需要时 render。 */
  step(deltaMs: number): void
  /** 没有在播的动画、也没有待渲染的改动。为 true 时帧循环必须停。 */
  isIdle(): boolean
  counters(): SceneCounters
  destroy(): void
}

export type CreateDuelPrototype = (opts: DuelPrototypeOptions) => Promise<DuelPrototype>
