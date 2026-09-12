/**
 * 组件目录页条目：面板内嵌提示条（7.1 第 3 条）。
 *
 * 状态矩阵：普通一条，其余四态全部不适用——纯显示，不吃指针事件，也没有加载过程。
 * 需求单提示 A 的状态那一行写的就是「普通 ✓ · 其余 —」。
 *
 * 两条按**压在哪种底上**分：夜色卡池那一档和纸面牌组栏那一档，字色和底都不一样。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { HintBar, type HintTone } from './HintBar'

const SIZE = { width: 420, height: 90 }
const BAR = { width: 380, height: 32 }

/** 两档各摆一句真会出现在构筑页上的提示。 */
const TEXTS: Record<HintTone, string> = {
  dark: '点卡面放大 · 点加号或拖进牌组栏加入',
  paper: '点减号移除 · 拖回卡池也行 · 牌组内不换位置',
}

function mount(ctx: StoryStage, tone: HintTone) {
  const text = new TextTextureCache(ctx.renderer)
  ctx.stage.addChild(
    new Graphics().rect(0, 0, ctx.width, ctx.height).fill({
      color: tone === 'dark' ? tokens.color.deck.poolBase : tokens.color.paper.base,
    }),
  )
  const bar = new HintBar({ ...BAR, tone, text: TEXTS[tone] }, { text })
  bar.position.set((ctx.width - BAR.width) / 2, (ctx.height - BAR.height) / 2)
  ctx.stage.addChild(bar)
  return () => text.destroy()
}

function spec(tone: HintTone) {
  return { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, tone) } }
}

export default {
  title: 'Canvas/HintBar',
  render: () => null,
}

/** 夜色档：贴在卡池底板底边。 */
export const Dark = { name: '夜色档', parameters: spec('dark') }

/** 纸面档：贴在牌组栏底边。 */
export const Paper = { name: '纸面档', parameters: spec('paper') }
