/**
 * 组件目录页条目：页签（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓（每个变体一条）· 选中 ✓（就在同一条里，第一项是选中的那个）
 *   悬停 ✗ · 按下 ✗ —— 目录页没有装模拟伪类的插件，摆不出来（同 README「状态矩阵」那一节）
 *   禁用 ✓（一条，整排压暗）· 加载 — 不适用
 *
 * 三个变体各画在自己该在的底上：药丸和纸页签在纸面上，描边胶囊在夜色卡池的头部条上——
 * 描边胶囊的字是浅色的，摆在纸上会看不见。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { Tabs, type TabsVariant } from './Tabs'

const SIZE = { width: 420, height: 120 }

/** 三档各摆一排真会出现在构筑页上的内容。 */
const ITEMS: Record<TabsVariant, { id: string; label: string }[]> = {
  A: [
    { id: 'a', label: '默认卡组' },
    { id: 'b', label: '低费流' },
    { id: 'c', label: '强卡流' },
  ],
  B: [
    { id: 'all', label: '全部 26' },
    { id: 'ai', label: 'AI 牌 16' },
    { id: 'skill', label: '技能牌 10' },
  ],
  C: [
    { id: 'all', label: '全部阵营' },
    { id: 'gpt', label: 'GPT' },
    { id: 'claude', label: 'Claude' },
  ],
}

function mount(ctx: StoryStage, variant: TabsVariant, disabled = false) {
  const text = new TextTextureCache(ctx.renderer)
  // 描边胶囊在夜色底板上，另外两档在纸上。垫一层底才看得出该有的对比。
  const dark = variant === 'C'
  ctx.stage.addChild(
    new Graphics()
      .rect(0, 0, ctx.width, ctx.height)
      .fill({ color: dark ? tokens.color.deck.poolBase : tokens.color.paper.base }),
  )

  const items = ITEMS[variant]
  const tabs = new Tabs({ variant, items, selectedId: items[0]?.id ?? null }, { text })
  tabs.setDisabled(disabled)
  // 纸页签是从纸面上翘起来的，所以它贴着一条基线摆；另外两档整体居中。
  tabs.position.set((ctx.width - tabs.boxWidth) / 2, (ctx.height - tabs.boxHeight) / 2)
  ctx.stage.addChild(tabs)
  return () => text.destroy()
}

function spec(variant: TabsVariant, disabled = false) {
  return { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, variant, disabled) } }
}

export default {
  title: 'Canvas/Tabs',
  render: () => null,
}

/** 药丸卡组页签：在几套牌组之间切换。选中那项才有底和描边。 */
export const DeckPill = { name: '药丸卡组页签', parameters: spec('A') }

/** 纸页签：全部 / AI 牌 / 技能牌，像文件夹标签那样只圆上面两个角。 */
export const Paper = { name: '纸页签', parameters: spec('B') }

/** 描边胶囊筛选：卡池头部按阵营筛，压在夜色底板上。 */
export const Chip = { name: '描边胶囊筛选', parameters: spec('C') }

/** 禁用：整排压暗、点了没反应。 */
export const Disabled = { name: '禁用', parameters: spec('A', true) }
