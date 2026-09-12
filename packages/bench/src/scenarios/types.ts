/**
 * 剧本的类型和固定步长。单独一个文件，是为了避开循环依赖：
 * index.ts 要 import 各段剧本（duel.ts 等）来登记注册表，各段剧本又要用这里的类型，
 * 类型留在 index.ts 里两边就绕成环了。
 */

import type { BenchScene } from '../scene/contract'

/** 一帧 16.667 毫秒，也就是 60Hz。剧本只用这一个步长，不用真实时间。 */
export const FRAME_MS = 1000 / 60

/** 页面侧提供的推进方式：手动时钟就调 scene.step()，真实时钟就等一帧过去。 */
export interface FrameDriver {
  manual: boolean
  /** 推进并记录一帧（手动时钟）。 */
  step(): void
  /** 等真实的一帧过去并记录（真实时钟）。 */
  waitFrame(): Promise<void>
}

export interface ScenarioContext {
  scene: BenchScene
  /** 发起一个动作，推帧直到它兑现，再多推到场景空闲。 */
  act(start: () => Promise<void>): Promise<void>
  /** 不发起动作，只把待渲染的改动推完（hover 之后用）。 */
  settle(): Promise<void>
}

export interface Scenario {
  name: string
  description: string
  /** 摆好初始状态。这一段不进指标——它是被测动作的前置条件，不是被测的动作。 */
  setup?(ctx: ScenarioContext): Promise<void>
  run(ctx: ScenarioContext): Promise<void>
}
