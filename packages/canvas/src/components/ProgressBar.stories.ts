/**
 * 组件目录页条目：进度条（7.1 第 3 条）。
 *
 * 状态矩阵：普通一条，其余四态全部不适用——它是纯显示，不吃指针事件，也没有加载过程。
 * 需求单条 A 的状态那一行写的就是「普通 ✓ · 其余 —」。
 *
 * 三条按**进度**分：空着、走了一半、满档。满档单拎一条是因为它换了颜色——
 * 那是构筑页上「这副牌能上桌了」唯一的一眼信号。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import type { StoryStage } from '../storyStage'
import { ProgressBar } from './ProgressBar'

const SIZE = { width: 360, height: 80 }
const BAR_WIDTH = 280

function mount(ctx: StoryStage, value: number) {
  // 它长在纸面牌组栏上，垫一层纸底才看得出该有的对比。
  ctx.stage.addChild(
    new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: tokens.color.paper.shade }),
  )
  const bar = new ProgressBar({ width: BAR_WIDTH, value })
  bar.position.set((ctx.width - BAR_WIDTH) / 2, (ctx.height - bar.boxHeight) / 2)
  ctx.stage.addChild(bar)
  // 没有自己建的纹理要收。
  return undefined
}

function spec(value: number) {
  return { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, value) } }
}

export default {
  title: 'Canvas/ProgressBar',
  render: () => null,
}

/** 空着：一张牌都还没选，只有轨。 */
export const Empty = { name: '空着', parameters: spec(0) }

/** 走了一半：金色填充。 */
export const Half = { name: '一半', parameters: spec(0.5) }

/** 满档：换成深绿，这副牌可以上桌了。 */
export const Full = { name: '满档', parameters: spec(1) }
