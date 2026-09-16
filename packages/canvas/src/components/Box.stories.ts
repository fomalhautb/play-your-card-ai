/**
 * 组件目录页条目：素方块（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「普通」那条，三档字号各摆一块
 *   悬停    不适用。这个组件没有悬停的视觉态（只换指针形状，拍不出来）
 *   按下    不适用，同上
 *   禁用    「禁用」那条，描边和字压到 0.4 透明度（底不压，见 Box.setDisabled）
 *   加载    不适用。它不等任何东西
 *
 * 条目底下仍然垫一块画布底色：方块自己已经有底了，但方块之间的空当还是目录页那层深色底，
 * 不垫的话整条看着是「深底上飘着几块浅灰片」，和真界面上那种通铺浅灰的样子对不上
 *（见 Box.ts 的 CANVAS_BACKGROUND）。
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import { Graphics } from 'pixi.js'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { Box, CANVAS_BACKGROUND } from './Box'

const SIZE = { width: 360, height: 260 }

/** 三块方块各自的字号档、尺寸和文案。 */
const ROWS = [
  { size: 'title' as const, width: 240, height: 56, label: '出牌吧，AI!' },
  { size: 'body' as const, width: 200, height: 44, label: '开始游戏' },
  { size: 'small' as const, width: 160, height: 32, label: '等对方进房…' },
]

function mount(ctx: StoryStage, disabled: boolean) {
  ctx.stage.addChild(
    new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: CANVAS_BACKGROUND }),
  )
  const text = new TextTextureCache(ctx.renderer)
  let y = 28
  for (const row of ROWS) {
    const box = new Box(
      { width: row.width, height: row.height, label: row.label, size: row.size },
      { text },
    )
    box.setDisabled(disabled)
    box.position.set((ctx.width - row.width) / 2, y)
    ctx.stage.addChild(box)
    y += row.height + 20
  }
  return () => text.destroy()
}

export default {
  title: 'Canvas/Box',
  render: () => null,
}

/** 三档字号：标题 24、正文 16、小字 12。 */
export const Normal = {
  name: '普通',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, false) } },
}

/** 禁用：描边和字压到 0.4 透明度，底和颜色一点没换。 */
export const Disabled = {
  name: '禁用',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, true) } },
}
