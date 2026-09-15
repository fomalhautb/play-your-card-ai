/**
 * 组件目录页条目：文字纹理缓存（7.1 第 3 条）。
 *
 * 看的是**铭牌上的模型名在不同长度下长什么样**。这件事只在这里看得见：
 * 卡面那条条目一次只印一个名字，而名字太长时 CardSprite 会把整段压窄
 * （不换行也不裁字，铭牌只有一行高），压到多窄要几种长度摆一起才判断得出来。
 *
 * 状态矩阵：文字纹理没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 *
 * 命名和 title 用英文的理由见 components/CardSprite.stories.ts 的文件头。
 */

import { Container, Graphics, Sprite, TextStyle } from 'pixi.js'
import { PALETTE } from '../fx/colors'
import { CARD_WIDTH } from '../layout/fanMath'
import type { StoryStage } from '../storyStage'
import { FONT_STACK, TextTextureCache } from './textCache'

/** 铭牌带的圆角。旧样式里最小那一档（3px），只有这条条目在用。 */
const STRIP_RADIUS = 3

const SIZE = { width: 360, height: 320 }

/**
 * 铭牌上名字的字号和最大宽度，两个数都抄自 CardSprite。
 *
 * 抄而不是从组件里导出：那两个常量是卡面自己的排版细节，为了目录页把它们变成公开 API
 * 就等于把"卡面怎么印"这件事的边界推开了。抄过来的代价是改了要跟着改这里，
 * 而这条条目正是为了让"改了之后长什么样"当场看得见——真走岔了，图上一眼就看得出。
 */
const NAME_FONT_SIZE = 14
const MAX_NAME_WIDTH = CARD_WIDTH - 24

/** 几种长度的名字，从最短的一档排到长得必须压缩的一档。 */
const NAMES = ['4o', 'Gpt 4o', 'Claude Sonnet', 'Gemini 2.5 Pro', 'Deepseek R1 Distill 70b']

/**
 * 一行一个名字，每行画一条铭牌带当底。
 *
 * 底是必须画的：铭牌上的字色是纸面上的深墨（battle.ink），直接摆在深色画布上看不见。
 * 带子的宽度就是 MAX_NAME_WIDTH，所以哪一行的字顶到了边、被压窄了多少，一眼可见。
 */
function mountNames(ctx: StoryStage) {
  const cache = new TextTextureCache(ctx.renderer)
  const style = new TextStyle({
    fontFamily: FONT_STACK,
    fontSize: NAME_FONT_SIZE,
    fontWeight: '600',
    fill: PALETTE.battleInk,
  })

  const rows = new Container()
  ctx.stage.addChild(rows)
  const stripHeight = 26
  const step = ctx.height / (NAMES.length + 1)

  NAMES.forEach((name, index) => {
    const cy = step * (index + 1)
    const strip = new Graphics()
    strip
      .roundRect(
        ctx.width / 2 - MAX_NAME_WIDTH / 2,
        cy - stripHeight / 2,
        MAX_NAME_WIDTH,
        stripHeight,
        STRIP_RADIUS,
      )
      .fill({ color: PALETTE.battlePaper, alpha: 0.94 })
    rows.addChild(strip)

    const texture = cache.get(`name|${name}`, name, style)
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    // 和 CardSprite 同一条规则：超宽就整体压窄，不换行也不裁字。
    sprite.scale.set(Math.min(1, MAX_NAME_WIDTH / texture.width))
    sprite.position.set(ctx.width / 2, cy)
    rows.addChild(sprite)
  })

  return () => cache.destroy()
}

export default {
  title: 'Canvas/TextTextureCache',
  render: () => null,
}

/** 五种长度的模型名，最后一行是压窄之后的样子。 */
export const NameLengths = {
  name: '铭牌文字：五种长度',
  parameters: {
    pixi: { ...SIZE, mount: mountNames },
  },
}
