/**
 * 组件目录页条目：对手手牌（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「1 张」「5 张」「10 张」——张数只改间距，张开角度是固定的（见 fanMath 的 SPREAD_DEG）
 *   悬停    不适用。对手的牌不接指针事件，它只是"对面手上还有几张"的告示
 *   按下    不适用，同上
 *   禁用    不适用
 *   加载    「发牌中」——一批新牌错开飞进来，停在飞到一半那一帧
 *
 * 锚点摆在画布**顶边**中点，和真对局一致：这排牌是倒挂在视口顶边的，
 * 整个容器转了 180°，于是"往下沉"自动变成"往上沉"（fanMath 文件头那条约定）。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { FoeHand } from './FoeHand'

/**
 * 画布尺寸。缩到 0.64 之后卡只剩 144 高，加上两端的下垂，200 装得下整排。
 * 宽度按真对局那档取，扇形才铺得开。
 */
const SIZE = { width: 1000, height: 220 }
/** 发牌是 0.4 秒一张、每张错开 0.12，五张全部落位要 0.88 秒，取 1000ms 停稳。 */
const SETTLE_MS = 1000
/** 「发牌中」停在哪一帧：第一张快落位、最后一张刚起飞，整批错开的样子最清楚。 */
const DEALING_MS = 250

function mount(ctx: StoryStage, count: number) {
  const deps = storyDeps(ctx)
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const hand = new FoeHand(
    // 和 duelLayout 一样按视口宽的 94% 取，再折算掉整排 0.64 的缩放。
    { areaWidth: (ctx.width * 0.94) / 0.64 },
    { animator: ctx.animator, back: textures.back },
  )
  hand.position.set(ctx.width / 2, 0)
  ctx.stage.addChild(hand)
  hand.setCount(count)
  return () => deps.dispose()
}

function spec(count: number, settleMs = SETTLE_MS) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs,
      mount: (ctx: StoryStage) => mount(ctx, count),
    },
  }
}

export default {
  title: 'Canvas/FoeHand',
  render: () => null,
}

/** 只剩一张：没有扇形可言，牌正着挂在中间。 */
export const OneCard = { name: '1 张', parameters: spec(1) }

/** 开局手牌数。两端往上垂，中间那张最靠下。 */
export const FiveCards = { name: '5 张', parameters: spec(5) }

/** 张数多了：总宽被 MAX_SPAN 顶住，间距压缩，牌背叠得更厉害。 */
export const TenCards = { name: '10 张', parameters: spec(10) }

/** 发牌中：五张错开 0.12 秒依次飞进来，停在第一张快落位、最后一张刚起飞那一拍。 */
export const Dealing = { name: '发牌中', parameters: spec(5, DEALING_MS) }
