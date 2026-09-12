/**
 * 组件目录页条目：徽章（7.1 第 3 条）。
 *
 * 状态矩阵：普通一条，其余四态全部不适用——五个变体在旧版里都写着
 * `pointer-events: none`，是纯显示的标记，没有交互态，也没有加载过程。
 * 需求单里徽章 A~E 的状态那一行写的都是「普通 ✓ · 其余 —」。
 *
 * 角标（D）拍四条，因为它的四档配色本来就是**要让人一眼分得开**的四种意思
 *（被干扰 / 变强了 / 变弱了 / 被保住了），少拍一档就等于那一档没有回归保护。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { bakeUiTextures } from '../fx/uiTextures'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { Badge, type BadgeOptions, type BadgeTone } from './Badge'

const SIZE = { width: 320, height: 160 }

function mount(ctx: StoryStage, options: BadgeOptions, onPaper: boolean) {
  const ui = bakeUiTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  /*
   * 铭牌那一档要垫纸底：它自己就是一块纸色的带子，压在目录页的深底上边界看不出来。
   * 别的几档在真界面里本来就压在深色（卡面原画、战场）上，不垫。
   */
  if (onPaper) {
    ctx.stage.addChild(
      new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: tokens.color.paper.night }),
    )
  }
  const badge = new Badge(options, { ui, text })
  // 章和角标在真界面里只有二三十像素，目录页放大两倍才看得清印刷细节。
  const zoom = 2
  badge.scale.set(zoom)
  badge.position.set(
    (ctx.width - badge.boxWidth * zoom) / 2,
    (ctx.height - badge.boxHeight * zoom) / 2,
  )
  ctx.stage.addChild(badge)
  return () => {
    ui.destroy()
    text.destroy()
  }
}

function spec(options: BadgeOptions, onPaper = false) {
  return { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, options, onPaper) } }
}

function mark(tone: BadgeTone, content: string) {
  return spec({ variant: 'D', tone, text: content })
}

export default {
  title: 'Canvas/Badge',
  render: () => null,
}

/** 费用圆章：盘底按各张牌的主色上色，中间印费用数字。 */
export const Cost = {
  name: '费用圆章',
  parameters: spec({ variant: 'A', cost: 3, accent: tokens.color.accent.ai }),
}

/** 问号帮助圆章：卡牌右上角那枚「这张牌能翻面」的提示章，常驻显示。 */
export const Help = { name: '问号帮助圆章', parameters: spec({ variant: 'B' }) }

/** 卡面铭牌：卡面下部那条带子，上面印模型名。 */
export const Nameplate = {
  name: '卡面铭牌',
  parameters: spec({ variant: 'C', name: 'Claude Fable 5' }, true),
}

/** 角标·被干扰：默认那一档琥珀色。 */
export const MarkAmber = { name: '角标：被干扰', parameters: mark('amber', '复读中') }

/** 角标·变强了：绿色那一档，已升级和已进化共用。 */
export const MarkUp = { name: '角标：变强了', parameters: mark('up', '已进化') }

/** 角标·变弱了：灰蓝那一档。 */
export const MarkDown = { name: '角标：变弱了', parameters: mark('down', '已降级') }

/** 角标·被保住了：青色那一档，已净化 / 保送 / 金钟罩共用。 */
export const MarkSafe = { name: '角标：被保住了', parameters: mark('safe', '金钟罩') }

/** 中线回合徽章：嵌在战场中线正中的一枚深蓝小牌。 */
export const Turn = {
  name: '中线回合徽章',
  parameters: spec({ variant: 'E', text: '第 3 轮 · 轮到你出牌' }),
}
