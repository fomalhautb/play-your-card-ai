/**
 * 组件目录页条目：牌组卡位（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓（空着 / 装了几张 / 让位中三条）
 *   悬停 ✗ · 按下 ✗ —— 格子本身不响应指针，能点的是每格上那颗「－」，
 *     它的五态在 `Canvas/SmallButton` 那几条里
 *   禁用 — 不适用 · 加载 — 不适用
 *
 * 画的是**手机档那个形状**（4 列 × 5 行）：桌面档是 2 列 × 10 行的竖长条，
 * 目录页那块画布装不下，而两档的格子长得一模一样，只是排法不同。
 */

import { tokens } from '@ai-duel/design'
import { createFakePlatform } from '@ai-duel/platform'
import { Graphics } from 'pixi.js'
import { bakeUiTextures } from '../fx/uiTextures'
import type { GridSpec } from '../layout/gridMath'
import { TextTextureCache } from '../runtime/textCache'
import { storyCard, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import type { CardSprite } from './CardSprite'
import { DeckSlots } from './DeckSlots'

const SIZE = { width: 420, height: 340 }

/** 4 列 × 5 行 = 20 格，和手机档抽屉里那一套同一个形状。 */
const GRID: GridSpec = {
  x: 20,
  y: 20,
  columns: 4,
  rows: 5,
  cellWidth: 88,
  cellHeight: 132,
  gapX: 10,
  gapY: 10,
}
/** 卡按格宽缩：格宽 88 ÷ 卡宽 150。 */
const CARD_SCALE = GRID.cellWidth / 150

const SILENT_PLATFORM = createFakePlatform()

function mount(ctx: StoryStage, filled: number, gap: number | null) {
  const ui = bakeUiTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const deps = storyDeps(ctx)
  // 它长在纸面牌组栏上。
  ctx.stage.addChild(
    new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: tokens.color.paper.shade }),
  )

  const slots = new DeckSlots(
    { grid: GRID, cardScale: CARD_SCALE },
    { ui, text, animator: ctx.animator, platform: SILENT_PLATFORM, clickSound: null },
  )
  ctx.stage.addChild(slots)

  const cards: CardSprite[] = []
  const entries: (CardSprite | null)[] = []
  for (let index = 0; index < filled; index += 1) {
    // 让位那一格是空的，卡要跳过它——这正是 slotEntries 在场景里干的事。
    if (index === gap) {
      entries.push(null)
      continue
    }
    const card = storyCard(ctx, deps, index)
    cards.push(card)
    entries.push(card)
  }
  slots.place(entries)
  slots.setGap(gap)

  return () => {
    for (const card of cards) card.destroy({ children: true })
    deps.dispose()
    ui.destroy()
    text.destroy()
  }
}

function spec(filled: number, gap: number | null = null) {
  return {
    pixi: {
      ...SIZE,
      // 卡面要图集，没有的话画面上会显示一句提示，不是白屏。
      needsAtlas: true,
      mount: (ctx: StoryStage) => mount(ctx, filled, gap),
    },
  }
}

export default {
  title: 'Canvas/DeckSlots',
  render: () => null,
}

/** 空着：20 个虚线格子，一张牌都还没选。 */
export const Empty = { name: '空着', parameters: spec(0) }

/** 装了几张：每格右上角挂一颗「－」。 */
export const Filled = { name: '装了六张', parameters: spec(6) }

/** 让位中：从卡池拖一张进来，第 3 格空着等它落下（金色高亮那格）。 */
export const Gap = { name: '拖入让位', parameters: spec(7, 3) }

/** 满 20 张：这副牌可以上桌了。 */
export const Full = { name: '满 20 张', parameters: spec(20) }
