/**
 * 组件目录页条目：对局左侧栏（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「桌面档」「触屏档」——两档并列的版式，宽度不同，里面的东西各按各的算
 *   悬停    不适用。侧栏是组装件，交互都在它装的那些零件上
 *   按下    不适用
 *   禁用    不适用
 *   加载    「开局前」就是那一档：两侧都还没选英雄，纸匾上也还没有类别
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { tokens } from '@ai-duel/design'
import { storyCard, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { SideBar } from './SideBar'

/** 画布尺寸。按桌面档侧栏取（306×748），四周留一点边。 */
const SIZE = { width: 360, height: 800 }
/** Token 细条的跳动 0.34 秒演完，取 500ms 停稳。 */
const SETTLE_MS = 500

function mount(ctx: StoryStage, width: number, filled: boolean) {
  const deps = storyDeps(ctx)
  const bar = new SideBar({ width, height: ctx.height - 40 }, deps)
  bar.position.set((ctx.width - width) / 2, 20)
  ctx.stage.addChild(bar)

  if (filled) {
    bar.setNextCategory('历史掌故')
    bar.theirs.setHero(storyCard(ctx, deps, 1))
    bar.mine.setHero(storyCard(ctx, deps, 0))
    bar.mine.setTokens(4, 7)
  } else {
    bar.setNextCategory('待定')
  }
  // 铭牌写的是玩家名，它盖住的是卡面自带那条卡名铭牌（见 PlayerPanel 的 layout）。
  bar.theirs.setName('对方')
  bar.mine.setName('我方')
  return () => deps.dispose()
}

function spec(width: number, filled = true) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mount(ctx, width, filled),
    },
  }
}

export default {
  title: 'Canvas/SideBar',
  render: () => null,
}

/** 桌面档：顶上吊「下一题」纸匾，下面上下两块玩家面板，中间一条带宝石的分隔线。 */
export const Desktop = { name: '桌面档', parameters: spec(tokens.size.battle.sidebarWidth) }

/** 触屏档：整条窄一截（250），两块面板跟着缩，纸匾不缩（它的尺寸是固定的）。 */
export const Touch = { name: '触屏档', parameters: spec(tokens.size.battle.sidebarWidthTouch) }

/** 开局前：两侧都还没选英雄，卡位空着，版式和满的时候一模一样。 */
export const Empty = {
  name: '开局前',
  parameters: spec(tokens.size.battle.sidebarWidth, false),
}
