/**
 * 页面那一侧 `window.__bench` 的契约：初始化参数、能调哪些方法、GPU 计时报什么。
 *
 * 单独一个文件，和 `scene/contract.ts` 是同一个理由：这是一份**跨进程的约定**。
 * 跑批器在 Node 里按它拼参数、读返回值（`tests/harness.ts`），实现在浏览器里
 *（`page/benchApi.ts`），两头只靠这组类型对齐——每一项都要一句说明才知道填什么、
 * 为什么不能少填。和实现放在一个文件里，光这组声明就占掉一百行。
 */

import type { HitPoint } from '@ai-duel/canvas'
import type { BenchMetrics, GlCounters, OverdrawResult } from '../metrics/types'
import type { SceneKind } from '../scenarios/index'
import type { AtlasOptions } from '../scene/atlas'
import type { DuelCommand, EffectTier } from '../scene/contract'
import type { KeyframeShots } from './keyframes'

export type { SceneKind }

export interface BenchInitOptions {
  profile: string
  width: number
  height: number
  resolution: number
  tier: EffectTier
  seed: number
  deck: string[]
  manualClock: boolean
  /**
   * 测哪个场景。默认 'duel'，也就是 canvas 包的真实对局场景——6.9 的指标大多要的是它的数字。
   * 'deck' 是构筑页那个场景（scene/deckSession.ts）；
   * 'stub' 是 bench 自带的桩场景，只在自测测量骨架时用（见 scene/stubScene.ts）。
   * 跑批那边按剧本自己登记的 `Scenario.scene` 传，别手填。
   */
  scene?: SceneKind
  /** 传了就从图集加载纹理，不传就按场景挑默认：真实场景用图集，桩场景用程序生成的纯色卡面。 */
  atlas?: AtlasOptions
  /** 剧本跑完之后空转多少帧，用来验证帧循环停了。 */
  idleFrames?: number
  /** 每隔多少帧采一次过度绘制，0 表示只在剧本结束后采一次。 */
  overdrawSampleEvery?: number
  /**
   * 这一局用哪副牌组。不给就用剧本自己那副。
   * 只有交互用例会传（它要摸到一张技能牌），理由见 scene/duelScript.ts。
   */
  duelDeck?: string[]
  /**
   * 我方这一端选哪位英雄。不给就是不选英雄。
   * 同样只有交互用例会传（它要按到侧栏那颗「发动」钮），理由见 scene/contract.ts 的 `hero`。
   */
  duelHero?: string
}

export interface GpuReport {
  available: boolean
  averageMs?: number
  reason?: string
}

interface RunOptions {
  /**
   * false 时不记录逐帧数据，也不采过度绘制。
   *
   * 堆采样要用这一档：逐帧记录本身每帧要建好几个对象，
   * 混进采样里量到的是测量骨架而不是场景，短剧本上骨架的那一份还会占大头。
   */
  record?: boolean
}

export interface BenchApi {
  init(opts: BenchInitOptions): Promise<void>
  run(segment: string, options?: RunOptions): Promise<void>
  /**
   * 开一局，并把开局那段演出（抛硬币、发牌）推完。
   *
   * 交互用例用它把画面摆到「手牌就在屏幕上、锁也放开了」那一刻，之后才轮到真指针上场。
   * 和 `run('deal')` 的区别是不热身、不记指标——那两样是给性能剧本的。
   */
  deal(): Promise<void>
  /**
   * 照脚本打出 n 张牌，把局面推到「场上真有单位」那一步。
   *
   * 交互用例里的英雄技能要有目标才按得动，而它自己用真指针打出的那一下**不会真的执行**
   *（场景发出来的指令在这里只记账，见 scene/duelSession.ts），所以场上的单位只能由脚本摆。
   * 和 `run('play10')` 的区别同 `deal`：不热身、不记指标。
   */
  play(count: number): Promise<void>
  /**
   * 一直推到场景闲下来。
   *
   * 手动时钟下没人替我们推帧，而真指针那几下之间是有演出要演的（牌飞出去、目标层立起来）。
   * 推不完（演出卡住了）会抛，不会静悄悄地挂着。
   */
  settle(): Promise<void>
  /** 场景自 init 以来发出的指令。交互用例断言的就是这张表。 */
  commands(): readonly DuelCommand[]
  /** 我方此刻的手牌。交互用例靠它认出哪一张是技能牌。 */
  handCards(): readonly { instanceId: string; cardId: string }[]
  /**
   * 场景图里 label 以 `prefix` 开头的对象，各给一个点得到的视口坐标。
   * 卡是 `card:<实例 id>`、战场格子是 `tile:<实例 id>`（见各组件的构造函数），
   * 「结束出牌」是 `button:end-play`（在 canvas 的 scenes/duel/parts.ts 上）。
   */
  hitPoints(prefix: string): HitPoint[]
  /**
   * 跑一段剧本，在指定的**帧号**上各抓一张画面。截图回归（6.6）用。
   *
   * 帧号从被测动作的第一帧算起（热身那一遍不计），和指标那边的口径一致。
   * **抓齐最后一张就收工**，不把剧本跑完——最长那一段（play10）一遍是一千五百多帧，
   * 而关键帧都排在前几百帧里，跑完剩下的只是白等。
   * 帧号排到剧本长度之外时抓到的图会比要的少，调用方据此报错。
   */
  keyframes(segment: string, stops: number[]): Promise<KeyframeShots>
  metrics(): BenchMetrics
  overdraw(): OverdrawResult
  reset(): Promise<void>
  segments(): string[]
  /** 当前的累计计数器快照。泄漏检查靠它读常驻纹理内存。 */
  counters(): GlCounters
  /** 计数器有没有真的接管到 WebGL 上下文。为 false 时下面所有数字都不可信。 */
  contextSeen(): boolean
  enableGpuTiming(): boolean
  gpu(): GpuReport
}
