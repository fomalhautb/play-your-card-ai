/**
 * 组件目录页给一条画布条目准备好的舞台（《正式版架构》7.1 第 3 条）。
 *
 * 和 `scenes/duelContract.ts` 一样，这是一份**跨包的约定**：
 * 舞台由装配层搭（`packages/client/dev/storybook/pixiStory.tsx`——建渲染器、建帧循环、
 * 加载图集、按参数重建都是它的事），而「往舞台上摆什么」写在各个组件自己的
 * `*.stories.ts` 里，也就是本包内部。两头都按这组类型写，改这里等于改两个包的调用方。
 *
 * 类型放在 `canvas` 而不是 `client`，是被依赖规则逼的，但结果正好：
 * story 文件在本包里，跨包只能 import 包入口（7.2 第 2 条），而 `canvas` 又不许碰 React
 * （见 .dependency-cruiser.cjs 的「边界-canvas-不碰-react」）——所以 story 只能拿到
 * 一份纯数据的声明，一行 React 都写不出来。
 */

import type { Container, Renderer } from 'pixi.js'
import type { Animator } from './runtime/animator'
import type { CardTextures } from './scenes/duelContract'

export interface StoryStage {
  /** 场景根节点。往这里挂东西就会被画出来。 */
  stage: Container
  /** 渲染器。要现烤纹理（预烤纹理、文字缓存那两条）的 story 从它拿。 */
  renderer: Renderer
  /** 补间的唯一入口。用它建的补间会被帧循环记账，演完帧循环自己停（3.6）。 */
  animator: Animator
  /** 渲染倍率。烤纹理时要用同一个数，否则在高分屏上糊。 */
  resolution: number
  /** 画布尺寸（CSS 像素），story 拿它摆版式。 */
  width: number
  height: number
  /** 卡面图集。声明了不要图集的 story 这里是 null。 */
  textures: CardTextures | null
  /** 手动推进一帧。想让某段演出停在中途的 story 自己调。 */
  step(deltaMs: number): void
  /**
   * 注册一个逐帧跟随（倾斜、指针跟随这类不走补间的东西）。
   * 回调返回「还在动吗」；返回 true 时帧循环不会停。
   */
  onFrame(advance: (deltaMs: number) => boolean): void
}

/**
 * 一条画布条目的清理函数：story 自己建的纹理要自己收。
 * 没什么要收的就不返回（也就是 undefined）。
 */
export type StoryTeardown = (() => void) | undefined
