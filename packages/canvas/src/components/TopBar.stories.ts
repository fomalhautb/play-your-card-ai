/**
 * 组件目录页条目：对局顶栏（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「常规」——第几轮 + 比分，右端一颗「离开」
 *   悬停    不适用。素方块没有悬停态（见 components/Box.ts）
 *   按下    同上，不适用
 *   禁用    不适用。顶栏一直都在
 *   加载    「等局面」——局面还没到手（联机客人在等房主开局），正中那格只剩轮次
 * 另拍两条：「断线」（`setStatus` 顶掉比分，改成一行状态字）和「手机档」（一条 390 宽的顶栏）。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { tokens } from '@ai-duel/design'
import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { TopBar } from './TopBar'

/** 画布尺寸。宽度按桌面档一整条顶栏取，高度留出上下各一点空白好看清那圈描边。 */
const SIZE = { width: 900, height: 140 }

/** 顶栏那一档的状态：给不给比分、要不要顶一行状态字、右端摆哪几颗钮。 */
interface Variant {
  score: { mine: number; theirs: number } | null
  status: string | null
  /** 不给就按桌面档那一条整宽。手机档那条单独给一个窄的。 */
  width?: number
  /** 不给就摆「离开」那一颗（`TopBarOptions.actions` 的默认值）。 */
  actions?: 'leave' | 'none'
  /** 不给就用桌面档的顶栏高度。 */
  height?: number
}

function mount(ctx: StoryStage, variant: Variant) {
  const deps = storyDeps(ctx)
  const bar = new TopBar(
    {
      width: variant.width ?? ctx.width,
      height: variant.height ?? tokens.size.battle.topbarHeight,
      actions: variant.actions,
    },
    deps,
  )
  bar.setRound(3)
  bar.setScore(variant.score)
  bar.setStatus(variant.status)
  bar.y = (ctx.height - bar.boxHeight) / 2
  ctx.stage.addChild(bar)
  return () => deps.dispose()
}

function spec(variant: Variant) {
  return {
    pixi: {
      ...SIZE,
      width: variant.width ?? SIZE.width,
      mount: (ctx: StoryStage) => mount(ctx, variant),
    },
  }
}

export default {
  title: 'Canvas/TopBar',
  render: () => null,
}

/** 常规：第几轮 + 比分，右端两颗图标钮。 */
export const Normal = {
  name: '常规',
  parameters: spec({ score: { mine: 2, theirs: 1 }, status: null }),
}

/** 两位数比分：数字是等宽的，从个位涨到两位时整块不会歪。 */
export const TwoDigits = {
  name: '两位数比分',
  parameters: spec({ score: { mine: 12, theirs: 9 }, status: null }),
}

/** 等局面：联机客人还没拿到局面，正中那块整个空着，顶栏高度不受影响。 */
export const Waiting = { name: '等局面', parameters: spec({ score: null, status: null }) }

/** 断线：状态字顶掉比分——链路断了的时候，几比几不是玩家最需要知道的事。 */
export const LinkDown = {
  name: '断线',
  parameters: spec({ score: { mine: 2, theirs: 1 }, status: '网络不稳，正在重连…' }),
}

/**
 * 手机档：390 宽、顶栏矮一档，右端只剩「离开」那一颗。
 *
 * 看点是正中那块**往左让**到不压着那颗钮为止（桌面档宽得很，让不让一个样）。
 * 静音那颗在手机上归设置页，「离开」割不得——它在手机上没有别的入口。
 */
export const Mobile = {
  name: '手机档',
  parameters: spec({
    score: { mine: 2, theirs: 1 },
    status: null,
    width: 390,
    height: tokens.size.battle.topbarHeightTouch,
    actions: 'leave',
  }),
}
