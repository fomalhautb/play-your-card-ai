/**
 * 组件目录页条目：Token 细条（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「半满」「打满」「挤到压边」「超出上限」——四档说的是同一件事的四种读数
 *   悬停    不适用。细条是纯显示，旧版就写着 `pointer-events: none`
 *   按下    不适用，同上
 *   禁用    不适用
 *   加载    不适用
 *
 * 四条都拍**跳动演完之后**的静止帧：`setTokens` 会让整列弹一下（0.34 秒），
 * `settleMs` 取 500 让它停稳，截图比的才是配色和排布，不是跳到一半的某一帧。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { TokenRail } from './TokenRail'

/** 画布尺寸。细条是 44×470 的竖长条，两边各留一点边。 */
const SIZE = { width: 200, height: 520 }
/** 跳动 0.12 + 0.22 秒演完，取 500ms 停稳。 */
const SETTLE_MS = 500

function mount(ctx: StoryStage, current: number, max: number) {
  const deps = storyDeps(ctx)
  const rail = new TokenRail(deps)
  rail.position.set((ctx.width - rail.boxWidth) / 2, (ctx.height - rail.boxHeight) / 2)
  ctx.stage.addChild(rail)
  rail.setTokens(current, max)
  return () => deps.dispose()
}

function spec(current: number, max: number) {
  return {
    pixi: {
      ...SIZE,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mount(ctx, current, max),
    },
  }
}

export default {
  title: 'Canvas/TokenRail',
  render: () => null,
}

/** 半满：开局那一档上限 5，花掉两点。上面两颗灭着，下面三颗还亮。 */
export const Half = { name: '半满', parameters: spec(3, 5) }

/** 打满：一点都没花，整列都亮着。 */
export const Full = { name: '打满', parameters: spec(9, 9) }

/** 挤到压边：上限涨到 16 时间距变成负数，星星互相压边，靠各自的描边分开彼此。 */
export const Crowded = { name: '挤到压边', parameters: spec(11, 16) }

/** 超出上限：「模型蒸馏」换来的两点顶在上限之上，换一档冷色，落款也照实写 11/9。 */
export const OverCap = { name: '超出上限', parameters: spec(11, 9) }
