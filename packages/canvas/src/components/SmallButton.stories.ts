/**
 * 组件目录页条目：小按钮（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓（三个变体各一条）· 悬停 ✓ · 按下 ✓ · 禁用 ✓ · 加载 — 不适用
 * 悬停和按下靠 `showState` 直接摆出来——目录页没有装模拟伪类的插件
 *（同 PlaqueButton 那几条，理由见 client/dev/storybook/README.md）。
 *
 * 每条各画在自己该在的底上：圆章在夜色卡池上，返回和线框小钮在纸面上。
 */

import { tokens } from '@ai-duel/design'
import { createFakePlatform } from '@ai-duel/platform'
import { Graphics } from 'pixi.js'
import { bakeUiTextures } from '../fx/uiTextures'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { SmallButton, type SmallButtonOptions } from './SmallButton'

const SIZE = { width: 260, height: 120 }

/** 目录页用假平台（触感和音效在截图里看不见），同 storyCards.ts 的理由。 */
const SILENT_PLATFORM = createFakePlatform()

type State = 'default' | 'hover' | 'pressed' | 'disabled'

function mount(ctx: StoryStage, options: SmallButtonOptions, state: State) {
  const ui = bakeUiTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  // 圆章是深底浅字，摆在纸上会糊成一团；另外两颗反过来。
  const dark = options.variant === 'J'
  ctx.stage.addChild(
    new Graphics()
      .rect(0, 0, ctx.width, ctx.height)
      .fill({ color: dark ? tokens.color.deck.poolBase : tokens.color.paper.base }),
  )

  const button = new SmallButton(options, {
    ui,
    text,
    animator: ctx.animator,
    platform: SILENT_PLATFORM,
    clickSound: null,
  })
  button.showState(state)
  button.position.set((ctx.width - button.boxWidth) / 2, (ctx.height - button.boxHeight) / 2)
  ctx.stage.addChild(button)
  return () => {
    ui.destroy()
    text.destroy()
  }
}

function spec(options: SmallButtonOptions, state: State = 'default') {
  return { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, options, state) } }
}

/** 返回钮在构筑页上是纸面墨色那一档（需求单按钮 H：颜色由使用方给）。 */
const BACK: SmallButtonOptions = { variant: 'H', caption: '返回', ink: tokens.color.paper.ink }
const ADD: SmallButtonOptions = { variant: 'J', glyph: 'plus' }
const REMOVE: SmallButtonOptions = { variant: 'J', glyph: 'minus' }
const RENAME: SmallButtonOptions = { variant: 'L', caption: '改名' }
const NEW_DECK: SmallButtonOptions = { variant: 'L', caption: '＋ 新建', dashed: true }

export default {
  title: 'Canvas/SmallButton',
  render: () => null,
}

/** 图标加文字钮：一枚左箭头加一行字，没有底。 */
export const Back = { name: '图标加文字钮', parameters: spec(BACK) }

/** 夜色圆章图标钮：卡池那张卡上的「＋」。 */
export const SealAdd = { name: '夜色圆章 · 加', parameters: spec(ADD) }

/** 同一颗圆章换成「－」：牌组那一格上的移除。 */
export const SealRemove = { name: '夜色圆章 · 减', parameters: spec(REMOVE) }

/** 线框小钮：牌组栏里的「改名」「删除」。 */
export const Wire = { name: '线框小钮', parameters: spec(RENAME) }

/** 虚线那一档：页签末尾那颗「新建牌组」。虚线是一段一段画出来的，见 SmallButton.ts。 */
export const WireDashed = { name: '线框小钮 · 虚线', parameters: spec(NEW_DECK) }

/** 悬停：整块提亮。 */
export const Hover = { name: '悬停', parameters: spec(RENAME, 'hover') }

/** 按下：整块缩一点。 */
export const Pressed = { name: '按下', parameters: spec(RENAME, 'pressed') }

/** 禁用：压暗，点了没反应（牌组已经 12 套时那颗「新建」就是这一档）。 */
export const Disabled = { name: '禁用', parameters: spec(NEW_DECK, 'disabled') }
