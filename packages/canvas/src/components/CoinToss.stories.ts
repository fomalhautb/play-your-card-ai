/**
 * 组件目录页条目：抛硬币过场（7.1 第 3 条）。
 *
 * 状态矩阵：过场没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 * 它自己的"变体"是**演到哪一拍**和**停在哪一面**，也就是下面四条。
 *
 * 整段 3.54 秒（`COIN_TOSS_TOTAL_MS`）。四个时刻是这么挑的：
 * - 200ms：币刚弹出来一半，`back.out` 还没冲到位，遮罩也才淡到一半；
 * - 500ms：转到中途，横向压得最扁的那一带——正反面硬切正是在这附近发生的，
 *   模拟翻转要是写错（比如忘了取绝对值），这一帧会立刻穿帮；
 * - 2000ms：已经停稳，看得清落在哪一面；
 * - 2000ms（后手那条）：同一时刻的另一面，两条并排就能确认 `mineFirst` 真的换了面。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { CoinToss } from './CoinToss'

/** 画布尺寸。币 240 见方，底下还有一行字，四周留出遮罩看得出边界的余量。 */
const SIZE = { width: 640, height: 480 }

function mount(ctx: StoryStage, mineFirst: boolean) {
  const deps = storyDeps(ctx)
  const layer = new CoinToss(deps)
  layer.resize(ctx.width, ctx.height)
  ctx.stage.addChild(layer)
  layer.play(mineFirst)
  return () => deps.dispose()
}

function spec(mineFirst: boolean, settleMs: number) {
  return {
    pixi: {
      ...SIZE,
      settleMs,
      mount: (ctx: StoryStage) => mount(ctx, mineFirst),
    },
  }
}

export default {
  title: 'Canvas/CoinToss',
  render: () => null,
}

/** 币弹出：刚从 0.4 倍弹到一半，遮罩也才淡到一半。 */
export const PoppingIn = { name: '币弹出', parameters: spec(true, 200) }

/** 转到一半：横向压到最扁的那一带，正反面硬切就发生在这附近（理由见文件头）。 */
export const MidSpin = { name: '转到一半', parameters: spec(true, 500) }

/** 停在先手：转完回弹之后的静止帧，币面朝上写着「先手」。 */
export const LandedFirst = { name: '停在先手', parameters: spec(true, 2000) }

/** 停在后手：同一时刻的另一面。和上一条并排看，能确认落面真的跟着 `mineFirst` 换。 */
export const LandedSecond = { name: '停在后手', parameters: spec(false, 2000) }
