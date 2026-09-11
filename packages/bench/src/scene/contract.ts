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
  /** 场景能发出的指令，也就是玩家在界面上做的那几件事的结果。交互用例按它断言。 */
  DuelCommand,
  /** 场景自己数的三个计数器，对应 6.9 表里画布内部才知道的那几行。 */
  DuelSceneCounters,
  /** 效果档位，对应《正式版架构》纪律 3.7。决定分辨率上限、特效开关和粒子数量。 */
  EffectTier,
} from '@ai-duel/canvas'

import type { CardTextures, DuelCommand, DuelSceneCounters, EffectTier } from '@ai-duel/canvas'

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
  /**
   * 这一局用哪副牌组。不给就用剧本自己那副（`duelScript.ts` 的 `BENCH_DECK`）。
   *
   * 只有交互用例会传：它要摸到一张技能牌才走得到「选目标」那条路，
   * 而三段确定性剧本的牌组一动，所有历史指标就没法比了（见 duelScript.ts）。
   */
  deck?: readonly string[]
  /**
   * 我方这一端选哪位英雄。不给就是**不选英雄**（三段确定性剧本走的就是这条）。
   *
   * 同样只有交互用例会传：它要按到侧栏那颗「发动」钮，而那颗钮只有在
   * 「英雄有主动技能、这一局还没用过」时才挂得上（见 canvas 的 applyView.ts）。
   * 配上英雄会多画一块技能钮，指标跟着变，所以确定性那几段一律不配。
   */
  hero?: string
}

/**
 * 构筑页那个场景多出来的两件事（6.9 表里「牌组编辑滚动」那一段）。
 *
 * 单独一个接口挂在 `BenchScene.deck` 上，而不是把这两条并进下面那张表：
 * 对局场景没有「翻页」也没有「把一张牌拖进牌组」，让它去实现两个空方法只会让契约变糊。
 * 剧本按 `Scenario.scene` 挑场景（见 scenarios/types.ts），拿不到这一份就是登记错了。
 */
export interface BenchDeckActions {
  /** 卡池往后翻 n 页，每翻一页等画面重排完。 */
  turnPages(count: number): Promise<void>
  /** 从卡池拖 n 张进牌组栏，一张一张来。 */
  dragCards(count: number): Promise<void>
}

/**
 * 剧本能对被测对象做的事。
 *
 * 前四个动作对应 6.9 里对局那几段剧本（`deal` / `play10` / `flip` / `settle`），
 * 底下是「真引擎 + 真编排层 + 真场景」；构筑页那一段的动作在 `deck` 里。
 */
export interface BenchScene {
  /**
   * 构筑页专用的那两件事。只有 `scene: 'deck'` 建出来的场景有，别的都是 undefined。
   */
  deck?: BenchDeckActions
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
   * 走完一轮结算：双方结束出牌 → 揭题 → 逐卡作答 → 盖章 → 比分 → 双方确认 → 结算层退场。
   *
   * 6.9 表里「一轮结算」那一段。它是全屏层里最重的一段演出（打字机、逐行盖章、比分脉冲），
   * 所以重点看的是离屏渲染为 0（3.1）和过度绘制不超三层（3.2）。
   */
  settleRound(): Promise<void>
  /**
   * 热身模式：开着的时候每一帧按十几倍的步长推。
   *
   * 热身跑的是和被测那遍一模一样的脚本，只是不看画面——它要的只是「该建的都建过一次」。
   * 照 60fps 推一遍要多花几千帧，而 setup 本来就不进指标，那几千帧纯粹是跑批时间。
   */
  setWarmup(warm: boolean): void
  /**
   * 场景自建出来以来发出的指令，按先后顺序。
   *
   * 剧本自己发指令、把场景发出来的丢掉（见 duelSession.ts），所以确定性那几段里它恒为空；
   * 交互用例（tests/interaction.spec.ts）反过来——它不发任何指令，只用真指针操作画面，
   * 断言的正是这张表。
   */
  commands(): readonly DuelCommand[]
  /**
   * 我方此刻手里那几张，按视图里的顺序。
   *
   * 也是给交互用例的：它要拖的是**那张技能牌**（只有技能牌才走得到「选目标」那条路），
   * 而屏幕上认牌只认实例 id，光看画面分不出哪张是技能牌。
   */
  handCards(): readonly { instanceId: string; cardId: string }[]
  step(deltaMs: number): void
  isIdle(): boolean
  counters(): DuelSceneCounters
  resize(width: number, height: number): void
  destroy(): void
}

/** 建被测对象的函数签名。真场景和桩场景都按它实现，benchApi 按 init 的 scene 选一个。 */
export type CreateBenchScene = (options: BenchSceneOptions) => Promise<BenchScene>
