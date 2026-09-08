/**
 * 组件目录页条目：匾额按钮（7.1 第 3 条）。
 *
 * 状态矩阵（墨蓝那一档拍全，其余变体只拍普通态——四个变体走的是同一份代码，
 * 差别只在配色令牌，各拍四张只会让基线多出十几张一样的图）：
 *   普通    「墨蓝：普通」及各变体那几条
 *   悬停    「墨蓝：悬停」「无底图标钮：悬停」
 *   按下    「墨蓝：按下」
 *   禁用    「墨蓝：禁用」「纸白：禁用」
 *   加载    不适用。按钮不自己加载任何东西；「加入中…」那种是**换文案**，
 *           由调用方重建一颗按钮，不是按钮的一个状态
 *
 * 悬停和按下靠 showState 直接摆姿态，不模拟指针：截图回归没有真指针，
 * 而按下那一下是补间，靠真事件触发就没法停在固定的一帧。
 *
 * 平台能力传的是 createFakePlatform()——按下会调触感和音效，假实现只记账不出声。
 */

import { createFakePlatform } from '@ai-duel/platform'
import { Graphics } from 'pixi.js'
import { bakeUiTextures } from '../fx/uiTextures'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import {
  PlaqueButton,
  type PlaqueButtonState,
  type PlaqueSizeName,
  type PlaqueVariant,
} from './PlaqueButton'

const SIZE = { width: 320, height: 140 }
/** 按下那一下是 70ms，推到 400ms 足够任何一段停稳。 */
const SETTLE_MS = 400

/** 给按钮 K 现画一枚剪影当图标。真界面里图标是调用方加载好传进来的，canvas 不管资源。 */
function iconTexture(ctx: StoryStage) {
  const g = new Graphics()
    .roundRect(6, 2, 20, 28, 3)
    .stroke({ width: 3, color: 0xffffff })
    .moveTo(14, 16)
    .lineTo(30, 16)
    .moveTo(24, 10)
    .lineTo(30, 16)
    .lineTo(24, 22)
    .stroke({ width: 3, color: 0xffffff })
  const texture = ctx.renderer.generateTexture({ target: g, resolution: ctx.resolution })
  g.destroy()
  return texture
}

interface Spec {
  variant: PlaqueVariant
  caption?: string
  size?: PlaqueSizeName
  state?: PlaqueButtonState
}

function mount(ctx: StoryStage, spec: Spec) {
  const ui = bakeUiTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const icon = spec.variant === 'K' ? iconTexture(ctx) : undefined
  const button = new PlaqueButton(
    { variant: spec.variant, caption: spec.caption, size: spec.size, icon },
    { ui, text, animator: ctx.animator, platform: createFakePlatform(), clickSound: null },
  )
  button.position.set((ctx.width - button.boxWidth) / 2, (ctx.height - button.boxHeight) / 2)
  button.showState(spec.state ?? 'default')
  ctx.stage.addChild(button)
  return () => {
    ui.destroy()
    text.destroy()
    icon?.destroy(true)
  }
}

/** 一条条目的 `parameters.pixi`。各条只差一个 spec，拼一次省得抄九遍。 */
function spec(next: Spec) {
  return { pixi: { ...SIZE, settleMs: SETTLE_MS, mount: (ctx: StoryStage) => mount(ctx, next) } }
}

export default {
  title: 'Canvas/PlaqueButton',
  render: () => null,
}

/** 普通态：墨蓝匾额，全站主操作键的默认档。 */
export const NavyNormal = {
  name: '墨蓝：普通',
  parameters: spec({ variant: 'A', caption: '开始游戏' }),
}

/** 悬停态：板面提亮，内框转暖，字跟着变。 */
export const NavyHover = {
  name: '墨蓝：悬停',
  parameters: spec({ variant: 'A', caption: '开始游戏', state: 'hover' }),
}

/** 按下态：整块以底边为支点压进去一截，配色仍是默认那一档。 */
export const NavyPressed = {
  name: '墨蓝：按下',
  parameters: spec({ variant: 'A', caption: '开始游戏', state: 'pressed' }),
}

/** 禁用态：板面褪成灰、字和框线一起掉对比，一眼看出点不动。 */
export const NavyDisabled = {
  name: '墨蓝：禁用',
  parameters: spec({ variant: 'A', caption: '开始游戏', state: 'disabled' }),
}

/** 纸白匾额的大档：对局右下角那颗「结束出牌」。 */
export const PaperEndTurn = {
  name: '纸白：结束出牌',
  parameters: spec({ variant: 'B', caption: '结束出牌', size: 'endTurn' }),
}

/** 纸白匾额的小档：手牌上方那颗「打出」，触屏才有。 */
export const PaperPlay = {
  name: '纸白：打出',
  parameters: spec({ variant: 'B', caption: '打出', size: 'play' }),
}

/** 纸白匾额的禁用态：等对方的时候这颗是灰的。 */
export const PaperDisabled = {
  name: '纸白：禁用',
  parameters: spec({ variant: 'B', caption: '等待对方…', size: 'endTurn', state: 'disabled' }),
}

/** 陶橙匾额：唯一一颗「催促对方」的次要操作键，配色刻意和主操作拉开。 */
export const Terracotta = {
  name: '陶橙：催一催',
  parameters: spec({ variant: 'C', caption: '催一催', size: 'urge' }),
}

/** 纸面无底图标钮：不画底也不画框，只有一枚实心剪影。 */
export const PlainIcon = {
  name: '无底图标钮：普通',
  parameters: spec({ variant: 'K' }),
}

/** 无底图标钮的悬停态：从常态的七成透明度回到全实。 */
export const PlainIconHover = {
  name: '无底图标钮：悬停',
  parameters: spec({ variant: 'K', state: 'hover' }),
}
