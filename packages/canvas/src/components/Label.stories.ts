/**
 * 组件目录页条目：通用文字（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通    「普通」「靠左对齐」
 *   悬停    不适用。文字自己没有交互，谁用它谁去改颜色（Label.setColor）
 *   按下    不适用，同上
 *   禁用    不适用。禁用是**用它的那个控件**的状态，表现为换一个颜色，见 PlaqueButton
 *   加载    不适用。建出来那一刻纹理就烤好了，没有"还没好"的中间态
 *
 * 「超长压窄」不是一个状态而是一条边界：给了 maxWidth 又排不下时会整体缩小，
 * 这一条拍的就是缩过之后的样子。
 *
 * title 和导出名一律用英文，理由见 CardSprite.stories.ts 的文件头。
 */

import { tokens } from '@ai-duel/design'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { Label } from './Label'

const SIZE = { width: 360, height: 160 }
/** 一句够长的中文，用来看压窄那一档。 */
const LONG = '这是一句长得排不下的模型名'

/** 摆一行字，顺便把这条 story 自己建的文字缓存交出去等着被收。 */
function mount(ctx: StoryStage, content: string, maxWidth?: number, align?: 'center' | 'left') {
  const text = new TextTextureCache(ctx.renderer)
  const label = new Label(
    content,
    { fontSize: 20, weight: '600', letterSpacing: 2, maxWidth, align },
    { text },
    tokens.color.page.foreground,
  )
  label.position.set(align === 'left' ? 24 : ctx.width / 2, ctx.height / 2)
  ctx.stage.addChild(label)
  return () => text.destroy()
}

export default {
  title: 'Canvas/Label',
  render: () => null,
}

/** 普通态：一行居中的字。 */
export const Normal = {
  name: '普通',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, '结束出牌') } },
}

/** 边界：给了最大宽度而排不下，整体等比缩小。 */
export const Truncated = {
  name: '超长压窄',
  parameters: { pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, LONG, 200) } },
}

/** 普通态：靠左对齐，原点在字的左端。 */
export const LeftAligned = {
  name: '靠左对齐',
  parameters: {
    pixi: { ...SIZE, mount: (ctx: StoryStage) => mount(ctx, '轮到你出牌', undefined, 'left') },
  },
}
