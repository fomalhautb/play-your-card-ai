/**
 * 组件目录页条目：选目标层（7.1 第 3 条）。
 *
 * 状态矩阵：这一层没有普通/悬停/按下/禁用/加载这五态，全部不适用——它要么立着要么没立。
 * 两条条目分别是「立起来」和「配着战场看」：后者把它压在一张真战场上，
 * 因为这一层的意义全在**压暗和亮着的格子之间的对比**，单拍一张灰幕看不出任何东西。
 *
 * 橙圈不在这一层（在 `BoardTile`，见 TargetingLayer 的文件头），所以第二条要自己摆战场。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyCard, storyCardName, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { BoardGrid } from './BoardGrid'
import { TargetingLayer } from './TargetingLayer'

/** 画布尺寸。要装得下两排小卡加顶边那条提示。 */
const SIZE = { width: 820, height: 500 }
/**
 * 战场往下让出多少给顶边那条提示。
 *
 * 提示条吊在视口顶边（离边 16），而被选中的格子要浮到压暗层**之上**才点得动——
 * 于是格子会盖住提示。真对局里让位的是对手那排手牌（战场本来就从顶栏下方起算），
 * 目录页这里没有手牌，直接把战场整个往下挪同样一截。
 */
const BOARD_TOP = 70
/** 淡入 0.18 秒，橙圈呼吸取一个固定相位，350ms 两样都停在同一处。 */
const SETTLE_MS = 350

function mount(ctx: StoryStage, withBoard: boolean) {
  const deps = storyDeps(ctx)
  if (withBoard) {
    const grid = new BoardGrid({ width: ctx.width - 40, height: ctx.height - BOARD_TOP - 20 }, deps)
    grid.position.set(20, BOARD_TOP)
    ctx.stage.addChild(grid)
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const id = `foe-${i}`
      grid.place(id, storyCard(ctx, deps, i), 'opponent')
      ids.push(id)
    }
    for (let i = 0; i < 2; i += 1) grid.place(`mine-${i}`, storyCard(ctx, deps, i + 3), 'self')
    // 压暗层在下、亮着的格子在上：真场景里也是这个顺序（旧版把可选目标抬到压暗层之上）。
    const layer = new TargetingLayer(deps)
    layer.resize(ctx.width, ctx.height)
    ctx.stage.addChild(layer)
    layer.begin(storyCardName(ctx, 9))
    grid.highlightTargets(ids.slice(0, 2))
    /*
     * 亮着的那两格要浮到压暗层之上才点得动，这一步在真场景里也归调用方做。
     * 换了父节点位置就要跟着换算：格子的坐标是相对它那一排的，而那一排又相对战场，
     * 战场自己还挪了 20px。`tileAt` 已经把前两级算好了，只差战场那一层的偏移。
     */
    for (const id of ids.slice(0, 2)) {
      const tile = grid.tile(id)
      const at = grid.tileAt(id)
      if (tile === null || at === null) continue
      ctx.stage.addChild(tile)
      tile.position.set(grid.x + at.x, grid.y + at.y)
    }
    return () => deps.dispose()
  }
  const layer = new TargetingLayer(deps)
  layer.resize(ctx.width, ctx.height)
  ctx.stage.addChild(layer)
  layer.begin('内存紧缺')
  return () => deps.dispose()
}

function spec(withBoard: boolean) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: withBoard,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mount(ctx, withBoard),
    },
  }
}

export default {
  title: 'Canvas/TargetingLayer',
  render: () => null,
}

/** 只有这一层：压暗加顶边那条提示。拍的是提示条本身的排版。 */
export const Bare = { name: '只有这一层', parameters: spec(false) }

/** 配着战场看：压暗压住整场，两个候选格连人带橙圈浮在压暗之上亮着。 */
export const OverBoard = { name: '配着战场看', parameters: spec(true) }
