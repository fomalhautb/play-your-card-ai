/**
 * 组件目录页条目：建场景时烤一次的那三张纹理（7.1 第 3 条）。
 *
 * 它们不是"组件"，但目录页照样要有条目：这三张是所有卡牌和特效共用的底料
 * （3.1 不许挂 Filter，所以"发光""边框"这类东西只能预先烤成纹理），
 * 改动它们会同时改掉卡面和命中特效的样子，而那两条条目里它们是被别的东西盖住的。
 * 摆开单看，才能一眼看出是哪张变了。
 *
 * 状态矩阵：纹理没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 *
 * 命名和 title 用英文的理由见 components/CardSprite.stories.ts 的文件头。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite, TextStyle } from 'pixi.js'
import { TextTextureCache } from '../runtime/textCache'
import type { StoryStage } from '../storyStage'
import { bakeTextures } from './bakedTextures'

/**
 * 画布尺寸。宽度按「三列，每列都装得下自己那张」定：
 * 一列 660 / 3 = 220，下面三个倍数放大之后最宽的一张是 150（边框铭牌），装得下。
 */
const SIZE = { width: 660, height: 380 }
/** 柔光点烤出来只有 64×64，按原尺寸看不清中心到边缘那条渐变。 */
const SOFT_DOT_SHOW = 2
/** 费用圆章直径只有 31，不放大看不出盘面外面那两圈描边。 */
const BADGE_SHOW = 3
/** 边框铭牌本来就是整张卡那么大（150×225），按原尺寸看。 */
const CHROME_SHOW = 1

/** 说明文字的样式。目录页自己的标签，不是组件的一部分，所以就地建。 */
function labelStyle(): TextStyle {
  return new TextStyle({
    fontFamily: tokens.font.family.serif,
    fontSize: tokens.font.size.lg,
    fill: tokens.color.page.foreground,
  })
}

/**
 * 三张纹理各摆一份，底下压一行说明。
 *
 * 柔光点和费用盘底烤出来都是白的（用的时候靠 tint 上色，tint 不触发重建，符合 3.10），
 * 所以这里就按白的看：目录页要看的是形状和渐变，不是某一次调用给的颜色。
 */
function mountBaked(ctx: StoryStage) {
  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const style = labelStyle()

  const items = [
    { texture: baked.cardChrome, scale: CHROME_SHOW, label: '边框铭牌 cardChrome' },
    { texture: baked.costBadge, scale: BADGE_SHOW, label: '费用盘底 costBadge' },
    { texture: baked.softDot, scale: SOFT_DOT_SHOW, label: '柔光点 softDot' },
  ]

  const columns = new Container()
  ctx.stage.addChild(columns)
  /** 每一列的横向中心。三列等分画布宽。 */
  const step = ctx.width / items.length
  const rowCenterY = ctx.height * 0.45
  const labelY = ctx.height * 0.88

  items.forEach((item, index) => {
    const cx = step * (index + 0.5)
    const sprite = new Sprite(item.texture)
    sprite.anchor.set(0.5)
    sprite.scale.set(item.scale)
    sprite.position.set(cx, rowCenterY)
    columns.addChild(sprite)

    const label = new Sprite(text.get(`label|${item.label}`, item.label, style))
    label.anchor.set(0.5)
    label.position.set(cx, labelY)
    columns.addChild(label)
  })

  return () => {
    baked.destroy()
    text.destroy()
  }
}

export default {
  title: 'Canvas/BakedTextures',
  render: () => null,
}

/**
 * 三张摆开看。
 *
 * 显示倍数各不相同（见上面三个常量），因为它们的真实尺寸差得太远：
 * 边框铭牌是整张卡（150×225），费用章约 31 见方，柔光点 64 见方。
 * 按原尺寸摆的话后两张只有指甲盖大。
 */
export const AllThree = {
  name: '三张摆开',
  parameters: {
    pixi: { ...SIZE, mount: mountBaked },
  },
}
