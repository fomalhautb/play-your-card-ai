/**
 * 组件目录页条目：对局顶栏（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「常规」——第几轮 + 比分，右端两颗图标钮
 *   悬停    不适用。顶栏本身没有悬停态；两颗图标钮的悬停已经在 PlaqueButton 的条目里拍过
 *   按下    同上，不适用
 *   禁用    不适用。顶栏一直都在
 *   加载    「等局面」——局面还没到手（联机客人在等房主开局），正中那块空着
 * 另拍两条：「断线」（`setStatus` 顶掉比分，改成一行状态字）和「手机档」
 *（一条 390 宽的顶栏，右端只剩「离开」那一颗，正中那块往左让到不压着它为止）。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { tokens } from '@ai-duel/design'
import { Graphics, type Texture } from 'pixi.js'
import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { TopBar } from './TopBar'

/** 画布尺寸。宽度按桌面档一整条顶栏取，高度留出上下各一点空白好看清下沿那两条线。 */
const SIZE = { width: 900, height: 140 }

/** 顶栏那一档的状态：给不给比分、要不要顶一行状态字、右端摆哪几颗钮。 */
interface Variant {
  score: { mine: number; theirs: number } | null
  status: string | null
  /** 不给就按桌面档那一条整宽。手机档那条单独给一个窄的。 */
  width?: number
  /** 不给就两颗都摆（`TopBarOptions.actions` 的默认值）。 */
  actions?: 'both' | 'leave' | 'none'
  /** 不给就用桌面档的顶栏高度。 */
  height?: number
}

/**
 * 两颗图标钮的剪影。
 *
 * 真界面里它们是美术资源（第 33 条才搬进来），组件本来就要求调用方给纹理。
 * 目录页这里现画两个几何图形顶上：拍的是**顶栏的版式**，不是图标长什么样。
 */
function placeholderIcon(ctx: StoryStage, kind: 'leave' | 'mute'): Texture {
  const size = tokens.size.control.iconBattle
  const g = new Graphics()
  if (kind === 'mute') {
    g.rect(size * 0.2, size * 0.34, size * 0.24, size * 0.32).fill({ color: 0xffffff })
    g.moveTo(size * 0.44, size * 0.5)
      .lineTo(size * 0.72, size * 0.22)
      .lineTo(size * 0.72, size * 0.78)
      .closePath()
      .fill({ color: 0xffffff })
  } else {
    g.rect(size * 0.2, size * 0.2, size * 0.34, size * 0.6).fill({ color: 0xffffff })
    g.rect(size * 0.54, size * 0.44, size * 0.28, size * 0.12).fill({ color: 0xffffff })
  }
  return ctx.renderer.generateTexture({ target: g, resolution: ctx.resolution, antialias: true })
}

function mount(ctx: StoryStage, variant: Variant) {
  const deps = storyDeps(ctx)
  const icons = { leave: placeholderIcon(ctx, 'leave'), mute: placeholderIcon(ctx, 'mute') }
  const bar = new TopBar(
    { width: ctx.width, height: variant.height, actions: variant.actions },
    { ...deps, icons },
  )
  bar.setRound(3)
  bar.setScore(variant.score)
  bar.setStatus(variant.status)
  bar.y = (ctx.height - bar.boxHeight) / 2
  ctx.stage.addChild(bar)
  return () => {
    deps.dispose()
    icons.leave.destroy(true)
    icons.mute.destroy(true)
  }
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
