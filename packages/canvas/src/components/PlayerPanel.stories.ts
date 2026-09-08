/**
 * 组件目录页条目：侧栏里的一块玩家面板（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「对方那块」「我方那块（带 Token 细条）」「还没选英雄」
 *   悬停    不适用。面板本身没有悬停态；里面那张英雄牌的悬停归卡牌自己（CardSprite 的条目）
 *   按下    不适用
 *   禁用    不适用
 *   加载    「还没选英雄」就是那一档：卡位空着，框和铭牌照旧
 * 另拍一条「被借走」：英雄牌正被放大查看，原位让出来但格子还占着。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyCard, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { PlayerPanel } from './PlayerPanel'

/** 画布尺寸。按桌面档侧栏的一半高取（侧栏 306×748，一块面板约 282×330）。 */
const SIZE = { width: 340, height: 380 }
/** Token 细条的跳动 0.34 秒演完，取 500ms 停稳。 */
const SETTLE_MS = 500

/** 一条条目的那一档：挂不挂细条、有没有英雄牌、牌是不是被借走了。 */
interface Variant {
  tokens?: boolean
  hero?: boolean
  held?: boolean
}

function mount(ctx: StoryStage, variant: Variant) {
  const deps = storyDeps(ctx)
  const panel = new PlayerPanel(
    { width: ctx.width - 40, height: ctx.height - 40, tokens: variant.tokens },
    deps,
  )
  panel.position.set(20, 20)
  ctx.stage.addChild(panel)

  /*
   * 铭牌写的是**玩家**的名字，不是卡名——它盖住的正是卡面自带的那条卡名铭牌
   *（见 PlayerPanel 的 layout）。所以这里给的是一个玩家昵称。
   */
  panel.setName(variant.tokens === true ? '我方' : '对方')
  if (variant.hero !== false) panel.setHero(storyCard(ctx, deps, 0))
  if (variant.tokens === true) panel.setTokens(4, 7)
  if (variant.held === true) panel.setHeroHeld(true)
  return () => deps.dispose()
}

function spec(variant: Variant) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mount(ctx, variant),
    },
  }
}

export default {
  title: 'Canvas/PlayerPanel',
  render: () => null,
}

/** 对方那块：一圈雕花框、一张英雄牌、牌脚一块铭牌。没有 Token 细条。 */
export const Foe = { name: '对方那块', parameters: spec({}) }

/** 我方那块：右缘多挂一条 Token 细条，整条按面板高等比缩进来。 */
export const Mine = { name: '我方那块', parameters: spec({ tokens: true }) }

/** 还没选英雄：卡位空着，框和铭牌照旧——面板尺寸和有牌时完全一样。 */
export const NoHero = { name: '还没选英雄', parameters: spec({ hero: false }) }

/** 被借走：英雄牌正在被放大查看，原位不可见但格子还占着，框和铭牌不动。 */
export const HeroHeld = { name: '被借走', parameters: spec({ held: true }) }
