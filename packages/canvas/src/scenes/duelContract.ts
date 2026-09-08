/**
 * 对局原型场景对外的契约：入参、句柄、计数器。
 *
 * 单独成文件是因为它是**跨包的约定**——`packages/bench` 的剧本和 `packages/client` 的开发页
 * 都按这组类型调用，改这里等于改两个包的调用方。放在实现文件里的话，
 * 每次动实现都要在一堆内部细节中间翻出这几个 interface 来确认没动到约定。
 */

import type { Texture } from 'pixi.js'
import type { EffectTier } from '../fx/effectTier'

/** 纹理由调用方加载好传进来：canvas 不管资源从哪来。 */
export interface CardTextures {
  faces: Record<string, Texture>
  back: Texture
}

export interface DuelPrototypeOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3：最高按 1.5，低端档可以降到 0.75）。 */
  resolution: number
  /** 档位决定特效开关、粒子数量；任何一档都不挂 Filter（3.1）。 */
  tier: EffectTier
  /** 所有随机（粒子、抖动）用它定种子，同 seed 同结果。 */
  seed: number
  textures: CardTextures
  /** 牌库顺序，元素是 textures.faces 的 key。 */
  deck: string[]
  /** true 时不注册任何真实时间源，只靠 step() 推进。 */
  manualClock: boolean
}

export interface DuelPrototypeCounters {
  /** 文字对象创建次数（3.5：动画期间应为 0）。 */
  textCreated: number
  /** render 调用次数。 */
  renders: number
  /** 帧循环回调次数（空闲时应为 0）。 */
  frameRequests: number
}

export interface DuelPrototype {
  /** 开局发牌：从牌库位置逐张飞入扇形。 */
  deal(count: number): Promise<void>
  /** 合成一段拖拽：拖起、越线、飞向战场落点、落地播命中特效、手牌重排。 */
  playCard(handIndex: number): Promise<void>
  /** 翻面。 */
  flip(handIndex: number): Promise<void>
  /**
   * 抬起某张（null 收回），用来测 hover 动画。
   *
   * @param at 指针压在卡面上的相对位置，左上角是 `{ rx: 0, ry: 0 }`、右下角是 `{ rx: 1, ry: 1 }`。
   *   传了就顺带走一遍真指针那条路：卡面跟着倾斜、反光跟着亮起来（见 components/cardTilt.ts）。
   *   不传就只抬牌——扇形动画和倾斜是两件事，只想测抬牌的调用方不该被迫编一个坐标。
   *   倾斜和反光都是逐帧收敛的，所以传了之后要再推几帧才收得住，一帧看不出效果。
   */
  hover(handIndex: number | null, at?: { rx: number; ry: number }): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /** 没有在播的动画；此时帧循环必须停（3.6）。 */
  isIdle(): boolean
  counters(): DuelPrototypeCounters
  /**
   * 视口变了。契约之外的扩展，给开发页跟随窗口大小用——
   * bench 的剧本视口固定，用不到它。
   */
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的（第二次什么都不做）。 */
  destroy(): void
}
