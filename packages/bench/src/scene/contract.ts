/**
 * 剧本和被测场景之间的契约。
 *
 * 被测的真身在 `@ai-duel/canvas` 的 `scenes/duelContract.ts`（那是跨包的约定），
 * 但剧本调的不是它——它认得的是 `PlayerView` / `Cue` / `DirectorLocks`，
 * 而剧本要说的是「开局发牌」「连着打十张」。中间那一层（开一局、发指令、推编排层的时钟）
 * 由 `duelSession.ts` 补上，桩场景照着同一组方法实现一份假的。
 *
 * bench 里的模块一律从这个文件取类型，好处是「被测场景是谁」只写在这一个地方。
 *
 * 关键约定是 `manualClock`：为 true 时场景不许注册任何真实时间源（rAF、Pixi 自动 ticker、
 * gsap 内部 ticker 都算），只能靠 `step()` 推进。动作返回的 Promise 因此只会在反复
 * `step()` 到 `isIdle()` 为 true 之后才 resolve，剧本的写法固定是
 * 「发起动作 → while (!isIdle()) step(16.667) → await」。
 */

export type {
  CardTextures,
  /** 场景自己数的三个计数器，对应 6.9 表里画布内部才知道的那几行。 */
  DuelSceneCounters,
  /** 效果档位，对应《正式版架构》纪律 3.7。决定分辨率上限、特效开关和粒子数量。 */
  EffectTier,
} from '@ai-duel/canvas'

import type { CardTextures, DuelSceneCounters, EffectTier } from '@ai-duel/canvas'

/** 建被测对象要的那几样。和 canvas 的 `DuelSceneOptions` 大体重合，去掉了剧本用不上的项。 */
export interface BenchSceneOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  resolution: number
  tier: EffectTier
  seed: number
  textures: CardTextures
  manualClock: boolean
}

/**
 * 剧本能对被测对象做的事。
 *
 * 三个动作对应 6.9 里那三段剧本，语义和验证阶段那一版一致（`deal` / `play10` / `flip`），
 * 只是底下从「原型自己演」换成了「真引擎 + 真编排层 + 真场景」。
 */
export interface BenchScene {
  /**
   * 回到「一局都还没开始」的空场，然后重开一局。
   *
   * 每段剧本的 setup 和 run 各调一次：setup 那遍是**热身**，
   * 让文字纹理、显示对象、着色器都建过一次；run 那遍测的才是稳态
   *（纪律 3.5 说的正是「文字只创建一次并缓存」，热身之后那条计数器才该是 0）。
   */
  restart(): Promise<void>
  /** 连着打 n 张：先我方，打不动了就结束出牌换对方，对方那几张走强制展示。 */
  playCards(count: number): Promise<void>
  /** 放大查看战场上第 index 个单位，看完关回去。 */
  inspect(index: number): Promise<void>
  /**
   * 热身模式：开着的时候每一帧按十几倍的步长推。
   *
   * 热身跑的是和被测那遍一模一样的脚本，只是不看画面——它要的只是「该建的都建过一次」。
   * 照 60fps 推一遍要多花几千帧，而 setup 本来就不进指标，那几千帧纯粹是跑批时间。
   */
  setWarmup(warm: boolean): void
  step(deltaMs: number): void
  isIdle(): boolean
  counters(): DuelSceneCounters
  resize(width: number, height: number): void
  destroy(): void
}

/** 建被测对象的函数签名。真场景和桩场景都按它实现，benchApi 按 init 的 scene 选一个。 */
export type CreateBenchScene = (options: BenchSceneOptions) => Promise<BenchScene>
