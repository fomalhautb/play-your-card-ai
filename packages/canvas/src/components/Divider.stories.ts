/**
 * 组件目录页条目：分隔线（7.1 第 3 条）。
 *
 * 状态矩阵：普通一条，其余四态全部不适用——纯装饰，不吃指针事件，也没有加载过程。
 * 需求单里边框 E 和 F 的状态那一行写的都是「普通 ✓ · 其余 —」。
 *
 * 三条条目：中线横杆（战场中间那条，中间留出空档给回合徽章）、
 * 分隔线加宝石的横版（侧栏两块玩家面板之间）和竖版（结算层题目区和答案区之间）。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { bakeUiTextures } from '../fx/uiTextures'
import type { StoryStage } from '../storyStage'
import { Divider, type DividerVariant } from './Divider'

const SIZE = { width: 360, height: 200 }

function mount(ctx: StoryStage, variant: DividerVariant, vertical: boolean) {
  const ui = bakeUiTextures(ctx.renderer)
  /*
   * 宝石那一档要垫纸底：宝石中间那块是纸色，直接压在目录页的深底上会看成一个洞。
   * 中线那一档不垫——它在真界面里本来就压在深色战场上。
   */
  if (variant === 'F') {
    ctx.stage.addChild(
      new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: tokens.color.battle.paper }),
    )
  }
  const length = vertical ? 160 : 300
  const divider = new Divider(
    { variant, length, gap: variant === 'E' ? 130 : undefined, vertical },
    { ui },
  )
  // 原点在线的起点，所以横版往左让半条、竖版往上让半条才是居中。
  divider.position.set(
    vertical ? ctx.width / 2 : (ctx.width - length) / 2,
    vertical ? (ctx.height - length) / 2 : ctx.height / 2,
  )
  ctx.stage.addChild(divider)
  return () => ui.destroy()
}

export default {
  title: 'Canvas/Divider',
  render: () => null,
}

/** 中线横杆：两端渐隐，中间留出一块空档给回合徽章（徽章本身是 Badge E）。 */
export const Midline = {
  name: '中线横杆',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, 'E', false) } },
}

/** 分隔线加宝石：侧栏上下两块玩家面板之间那条。 */
export const Gem = {
  name: '分隔线加宝石',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, 'F', false) } },
}

/** 竖版：整条转 90°，几何一行都没改。 */
export const GemVertical = {
  name: '分隔线加宝石：竖版',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, 'F', true) } },
}
