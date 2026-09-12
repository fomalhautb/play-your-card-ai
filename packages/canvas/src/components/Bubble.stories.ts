/**
 * 组件目录页条目：气泡和提示（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    三个变体各一条（都是淡入完成之后的样子）
 *   悬停    不适用。三处旧样式都写着 `pointer-events: none`，它们盖在手牌和按钮上面
 *   按下    不适用，同上
 *   禁用    不适用。气泡要么在要么不在，没有"在但点不动"这一档
 *   加载    不适用。文字建出来那一刻纹理就烤好了
 *
 * 建出来默认是藏着的（alpha 0），所以每条都调一次 show() 再推到淡入结束那一帧。
 * 淡入是 0.24s，settleMs 给 400ms 足够停稳。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { Bubble, type BubbleVariant } from './Bubble'

const SIZE = { width: 360, height: 200 }
/** 淡入 0.24s，推到 400ms 停稳。 */
const SETTLE_MS = 400

function mount(ctx: StoryStage, variant: BubbleVariant, content: string) {
  const text = new TextTextureCache(ctx.renderer)
  /*
   * 喊话气泡那一档垫一块深底：它自己是纸色的，压在目录页的深色底上边界还看得出来，
   * 但尾巴那两层三角要有对比才分得清里外，垫一块战场那档的深色最接近真界面。
   */
  if (variant === 'C') {
    ctx.stage.addChild(
      new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: tokens.color.paper.night }),
    )
  }
  const bubble = new Bubble({ variant, content, maxWidth: 260 }, { text, animator: ctx.animator })
  bubble.position.set((ctx.width - bubble.boxWidth) / 2, (ctx.height - bubble.boxHeight) / 2)
  ctx.stage.addChild(bubble)
  bubble.show()
  return () => text.destroy()
}

function spec(variant: BubbleVariant, content: string) {
  return {
    pixi: {
      ...SIZE,
      settleMs: SETTLE_MS,
      mount: (ctx: StoryStage) => mount(ctx, variant, content),
    },
  }
}

export default {
  title: 'Canvas/Bubble',
  render: () => null,
}

/** 浮起小气泡：手牌锁住时贴着那张牌顶上弹出来的原因。 */
export const Tip = { name: '浮起小气泡', parameters: spec('B', '轮到对方出牌') }

/** 喊话气泡：「催一催」喊出去之后的字幕，右下角带一条指向按钮的小尾巴。 */
export const Shout = { name: '喊话气泡', parameters: spec('C', '快点啊 我等的花都谢了') }

/**
 * 错误红字：指令被引擎拒了。没有底——它压在战场上，加个底反而像个弹窗。
 * 导出名叫 Rejected 不叫 Error：后者会盖住全局的 Error（biome 的 noShadowRestrictedNames）。
 */
export const Rejected = { name: '错误红字', parameters: spec('E', 'Token 不够，这张打不出') }
