/**
 * 组件目录页条目：展示层（7.1 第 3 条）。
 *
 * 强制展示和放大查看是同一个组件（见 RevealOverlay 的文件头），所以两条链路都在这里拍。
 *
 * 状态矩阵：浮层没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 * 它自己的"变体"是演到哪一拍，也就是下面四条：
 * - 「飞入中」：卡从战场格子飞向中央、正放大到一半（275ms 是 `REVEAL_IN_MS` 550 的中点）；
 * - 「停留」：飞到位之后的静止帧，浮动补间刚起步；
 * - 「带字幕」：同一拍加一行字幕——字幕是延后到进场六成处才淡入的，单独拍一条才看得到；
 * - 「原地淡入」：找不到起飞点时的降级路径，卡直接在中央淡出来。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyCard, storyCardName, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { RevealOverlay } from './RevealOverlay'

/** 画布尺寸。卡放大到 1.7 倍就是 255×382，四周要留出遮罩看得出边界的余量。 */
const SIZE = { width: 720, height: 560 }
/** 卡从哪儿起飞：左下角一个战场格子那么大的点，和真对局里的起飞点同一个量级。 */
const FROM = { x: 150, y: 460, scale: 0.73 }

/** 一条条目的那一档。 */
interface Variant {
  /** 从战场飞过来，还是原地淡入（降级路径）。 */
  fromTile: boolean
  hold?: boolean
  caption?: boolean
}

function mount(ctx: StoryStage, variant: Variant) {
  const deps = storyDeps(ctx)
  const layer = new RevealOverlay({}, deps)
  layer.resize(ctx.width, ctx.height)
  ctx.stage.addChild(layer)
  layer.enter(storyCard(ctx, deps, 2), variant.fromTile ? FROM : null)
  if (variant.caption === true) layer.showCaption(`对方打出了 ${storyCardName(ctx, 2)}`)
  if (variant.hold === true) layer.hold()
  return () => deps.dispose()
}

function spec(variant: Variant, settleMs: number) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs,
      mount: (ctx: StoryStage) => mount(ctx, variant),
    },
  }
}

export default {
  title: 'Canvas/RevealOverlay',
  render: () => null,
}

/** 飞入中：卡在从战场格子飞向中央的半路上，遮罩也才淡到一半。 */
export const FlyingIn = { name: '飞入中', parameters: spec({ fromTile: true }, 275) }

/** 停留：飞到位之后的静止帧。浮动补间刚起步，卡还基本在原位。 */
export const Holding = { name: '停留', parameters: spec({ fromTile: true, hold: true }, 600) }

/** 带字幕：字幕延后到进场六成处才淡入，所以要单独拍一条才看得到它。 */
export const WithCaption = {
  name: '带字幕',
  parameters: spec({ fromTile: true, hold: true, caption: true }, 800),
}

/** 原地淡入：找不到起飞点时的降级路径，卡直接在中央淡出来（时长短一档）。 */
export const PopIn = { name: '原地淡入', parameters: spec({ fromTile: false }, 400) }
