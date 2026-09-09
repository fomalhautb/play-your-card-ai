/**
 * 组件目录页条目：扇形手牌（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「1 张」「5 张」「10 张」——张数只改间距，不改张开角度（见 fanMath 的 SPREAD_DEG）
 *   悬停    「悬停：抬起第三张」
 *   按下    不适用。按下去之后就是拖拽，牌被摘出排布交给拖拽层，扇形只负责合拢
 *   禁用    不适用。能不能出牌是场景的判断，扇形不画禁用的样子
 *   加载    不适用。扇形排的是已经建好的卡
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { bakeTextures } from '../fx/bakedTextures'
import { PLAYER_FAN } from '../layout/fanMath'
import { TextTextureCache } from '../runtime/textCache'
import { cardVisualOf } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { CardSprite } from './CardSprite'
import { HandFan } from './HandFan'

/**
 * 画布尺寸。
 *
 * 高度按**抬起来那张**留：它抬到离锚点 HOVER_BOTTOM=6 处、放大约 1.9 倍，
 * 卡顶因此在锚点上方约 6 + 225×1.9 ≈ 434 处。留 460 才不会把抬起的牌切掉头。
 * 四条条目共用同一个尺寸，几张图才摆得到一起比。
 */
const SIZE = { width: 1000, height: 460 }
/** 重排是 LAYOUT_DUR=0.4s，抬起那张还带一段冲过头再弹回的缓动，600ms 之后全部停稳。 */
const SETTLE_MS = 600

/**
 * 摆一排牌。
 *
 * 锚点压在画布底边中点，和真对局的版式一致（见 scenes/duelLayout.ts 的 handOrigin）：
 * 扇形两端那两个角本来就该沉出屏幕，抬到画面中间反而不是"握在手里"的样子。
 *
 * @param hoverIndex 抬起第几张（从 0 数），−1 表示没人被抬起。
 */
function mountFan(ctx: StoryStage, count: number, hoverIndex: number) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const keys = Object.keys(textures.faces)
  if (keys.length === 0) throw new Error('图集里一张卡面都没有')

  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const fan = new HandFan({
    animator: ctx.animator,
    geometry: PLAYER_FAN,
    // 和 duelLayout 一样按视口宽的 94% 取：目录页里的排布要和真对局是同一套。
    areaWidth: ctx.width * 0.94,
  })
  fan.position.set(ctx.width / 2, ctx.height)
  ctx.stage.addChild(fan)

  for (let i = 0; i < count; i += 1) {
    const key = keys[i % keys.length]
    const face = key === undefined ? undefined : textures.faces[key]
    if (key === undefined || face === undefined) break
    const card = new CardSprite(cardVisualOf(key, i, face, textures.back), {
      baked,
      text,
      glare: true,
    })
    // 传 null 就是"没有牌库位置"那条退路：牌在基准位下方沉着淡入。
    // 目录页要的是落位之后的静态图，从哪儿飞进来不重要。
    fan.insert(card, null)
  }
  fan.setHover(hoverIndex)
  fan.layout('reflow')

  return () => {
    baked.destroy()
    text.destroy()
  }
}

/** 一条条目的 `parameters.pixi`。四条只差张数和抬起哪张。 */
function fanSpec(count: number, hoverIndex: number) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mountFan(ctx, count, hoverIndex),
    },
  }
}

export default {
  title: 'Canvas/HandFan',
  render: () => null,
}

/** 只剩一张：没有扇形可言，牌正着摆在中间。 */
export const OneCard = {
  name: '1 张',
  parameters: fanSpec(1, -1),
}

/** 开局手牌数。间距是理想值 GAP_PER_CARD=95，相邻卡已经互相压住一点。 */
export const FiveCards = {
  name: '5 张',
  parameters: fanSpec(5, -1),
}

/** 上限附近：总宽被 MAX_SPAN 顶住，间距被压缩，牌叠得更厉害。 */
export const TenCards = {
  name: '10 张',
  parameters: fanSpec(10, -1),
}

/** 悬停态：第三张抬起转正放大，两侧的牌被推开让位（见 handLayout 的 neighborPushes）。 */
export const HoverThird = {
  name: '悬停：抬起第三张',
  parameters: fanSpec(5, 2),
}
