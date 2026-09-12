/**
 * 组件目录页条目：战场两排卡槽（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「空场」「常规」「挤到压边」——张数只改间距，永不换行
 *   悬停    不适用。小卡的悬停倾斜归 cardTilt，那是卡自己的事
 *   按下    不适用
 *   禁用    不适用
 *   加载    不适用。战场排的是已经建好的卡
 * 另外四条拍演出：角标、选目标的橙圈、进化和简易进场那两下停在关键帧。
 *
 * 「进化中」那条停在 300ms：绿光已经亮到最实（0.21 秒淡入完），浮字升到一半，
 * 弹跳刚回到原大——三样同时看得见。停在末尾的话绿光和浮字都淡没了，等于什么都没拍到。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyCard, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { BoardGrid } from './BoardGrid'

/** 画布尺寸。两排 165 高的小卡加中线，四周留出橙圈和进化辉光探出去的余量。 */
const SIZE = { width: 820, height: 460 }
/** 排位补间是瞬时的（直接写 position），但橙圈的呼吸要停在一个固定相位，取 350ms。 */
const SETTLE_MS = 350
/** 进化那条停在哪一帧，理由见文件头。60fps 下 300 除得尽（18 步）。 */
const EVOLVE_SETTLE_MS = 300
/**
 * 简易进场停在 100ms（整段 400ms 的四分之一）。
 *
 * 回弹那档缓动（`back.out(1.7)`）冲得很快：走到一半时它已经越过原大了，
 * 拍出来和落定的样子几乎没差别。停在四分之一处卡才刚涨到九成、淡入也才走过八成，
 * 和旁边那张落定的一比就看得出它是刚出现的。
 */
const POP_IN_SETTLE_MS = 100

/** 一条条目的那一档。 */
interface Variant {
  /** 上排（对方）和下排（我方）各摆几张。 */
  counts: { opponent: number; self: number }
  marks?: boolean
  targets?: boolean
  evolve?: boolean
  popIn?: boolean
}

function mount(ctx: StoryStage, variant: Variant) {
  const deps = storyDeps(ctx)
  const grid = new BoardGrid({ width: ctx.width - 40, height: ctx.height - 40 }, deps)
  grid.position.set(20, 20)
  ctx.stage.addChild(grid)
  grid.setTurnBadge('第 3 轮 · 轮到你出牌')

  let index = 0
  const ids: string[] = []
  for (const side of ['opponent', 'self'] as const) {
    for (let i = 0; i < variant.counts[side]; i += 1) {
      const id = `${side}-${i}`
      grid.place(id, storyCard(ctx, deps, index), side)
      ids.push(id)
      index += 1
    }
  }

  if (variant.marks === true) {
    grid.setMark(ids[0] ?? '', [{ text: '复读中', tone: 'amber' }])
    grid.setMark(ids[1] ?? '', [
      { text: '金钟罩', tone: 'safe' },
      { text: '已降级', tone: 'down' },
    ])
  }
  if (variant.targets === true) grid.highlightTargets(ids.slice(0, 2))
  if (variant.evolve === true) grid.transform(ids[0] ?? '', storyCard(ctx, deps, index))?.destroy()
  if (variant.popIn === true) grid.popIn(ids[0] ?? '')
  return () => deps.dispose()
}

function spec(variant: Variant, settleMs = SETTLE_MS) {
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
  title: 'Canvas/BoardGrid',
  render: () => null,
}

/** 空场：只有中线和那枚回合徽章。两排的分界线在这一条上看得最清楚。 */
export const Empty = { name: '空场', parameters: spec({ counts: { opponent: 0, self: 0 } }) }

/** 常规：上下各三张，间距是理想值，卡之间还没挨上。 */
export const Normal = { name: '常规', parameters: spec({ counts: { opponent: 3, self: 3 } }) }

/** 挤到压边：一排七张，装不下就互相压边，永不换行——折行会越过中线戳进对方那半边。 */
export const Crowded = { name: '挤到压边', parameters: spec({ counts: { opponent: 7, self: 2 } }) }

/** 带角标：一张挂一枚、一张挂两枚，四档配色里挑了三档。 */
export const WithMarks = {
  name: '带角标',
  parameters: spec({ counts: { opponent: 2, self: 2 }, marks: true }),
}

/** 选目标：前两格亮起会呼吸的橙圈。停在 350ms，呼吸正在往最实的方向走。 */
export const Targeting = {
  name: '选目标',
  parameters: spec({ counts: { opponent: 2, self: 2 }, targets: true }),
}

/** 进化中：绿光最实、浮字升到一半、弹跳刚回原大，三样同时在（理由见文件头）。 */
export const Evolving = {
  name: '进化中',
  parameters: spec({ counts: { opponent: 2, self: 2 }, evolve: true }, EVOLVE_SETTLE_MS),
}

/** 简易进场：上排第一格正从六成大小弹起来、淡入还没走完（理由见文件头）。 */
export const PoppingIn = {
  name: '简易进场',
  parameters: spec({ counts: { opponent: 2, self: 2 }, popIn: true }, POP_IN_SETTLE_MS),
}
