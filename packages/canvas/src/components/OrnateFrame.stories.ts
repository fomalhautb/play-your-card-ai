/**
 * 组件目录页条目：双线雕花框（7.1 第 3 条）。
 *
 * 状态矩阵：普通一条，其余四态全部不适用——它是纯装饰，不吃指针事件，也没有加载过程。
 * 需求单里边框 A 的状态那一行写的也是「普通 ✓ · 其余 —」。
 *
 * 两条条目差的是尺寸：这个框要能套任意大小的面板（侧栏是竖长条、顶部区块是横条），
 * 四个角是固定 38×38、四条边跟着拉伸，拍两个比例才看得出来有没有拉歪。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { bakeUiTextures } from '../fx/uiTextures'
import type { StoryStage } from '../storyStage'
import { OrnateFrame } from './OrnateFrame'

const SIZE = { width: 360, height: 300 }

/**
 * 铺一块纸底再套上框。
 * 目录页的画布底色是页面那档深色，不垫纸的话这圈线看着像浮在夜空里——
 * 而它在真界面里永远是压在纸面上的。
 */
function mount(ctx: StoryStage, width: number, height: number) {
  const ui = bakeUiTextures(ctx.renderer)
  const x = (ctx.width - width) / 2
  const y = (ctx.height - height) / 2
  const paper = new Graphics().rect(x, y, width, height).fill({ color: tokens.color.battle.paper })
  ctx.stage.addChild(paper)

  const frame = new OrnateFrame(width, height, { ui })
  frame.position.set(x, y)
  ctx.stage.addChild(frame)
  return () => ui.destroy()
}

export default {
  title: 'Canvas/OrnateFrame',
  render: () => null,
}

/** 普通态：横着的一块，四个角看得清。 */
export const Normal = {
  name: '普通',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, 300, 200) } },
}

/** 普通态：竖长条，对局左侧栏那个比例。四条边拉伸，四个角不变形。 */
export const Tall = {
  name: '竖长条',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, 150, 260) } },
}
