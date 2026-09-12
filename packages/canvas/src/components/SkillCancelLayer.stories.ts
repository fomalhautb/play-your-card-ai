/**
 * 组件目录页条目：英雄技能抵消层（7.1 第 3 条）。
 *
 * 状态矩阵：过场没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 * 它自己的"变体"是演到哪一拍，也就是下面三条。
 *
 * 整段 2.26 秒（`SKILL_CANCEL_TOTAL_MS`）。三个时刻：
 * - 250ms：大字正从 0.6 倍弹起来、说明那行还没上；
 * - 900ms：两行都到位的静止帧，也是这一层唯一"读得完"的一拍；
 * - 2100ms：整层正在淡出。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { SkillCancelLayer } from './SkillCancelLayer'

/** 画布尺寸。大字 76px，说明那行最宽 720，留够两边的空白。 */
const SIZE = { width: 900, height: 400 }
/** 拍这一层用的那对文案，三条共用，比的才是演出不是文字。 */
const TITLE = '以子之矛'
const DETAIL = '对方的「内存紧缺」被抵消了'

function mount(ctx: StoryStage) {
  const deps = storyDeps(ctx)
  const layer = new SkillCancelLayer(deps)
  layer.resize(ctx.width, ctx.height)
  ctx.stage.addChild(layer)
  layer.play(TITLE, DETAIL)
  return () => deps.dispose()
}

function spec(settleMs: number) {
  return { pixi: { ...SIZE, settleMs, mount } }
}

export default {
  title: 'Canvas/SkillCancelLayer',
  render: () => null,
}

/** 大字弹入：技能名正从 0.6 倍弹起来，说明那行还压着没上。 */
export const TitlePopping = { name: '大字弹入', parameters: spec(250) }

/** 两行都到位：这一层唯一静止的一拍，也是玩家真正读它的那一刻。 */
export const Settled = { name: '两行都到位', parameters: spec(900) }

/** 淡出：整层正在退，两行字一起变淡。 */
export const FadingOut = { name: '淡出', parameters: spec(2100) }
