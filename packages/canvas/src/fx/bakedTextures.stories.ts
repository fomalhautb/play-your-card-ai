/**
 * 组件目录页条目：建场景时烤一次的那批卡牌纹理（7.1 第 3 条）。
 *
 * 它们不是"组件"，但目录页照样要有条目：这批是所有卡牌和特效共用的底料
 * （3.1 不许挂 Filter，所以"发光""羽化""投影"这类东西只能预先烤成纹理），
 * 改动它们会同时改掉卡面和命中特效的样子，而那两条条目里它们是被别的东西盖住的。
 * 摆开单看，才能一眼看出是哪张变了。
 *
 * 状态矩阵：纹理没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 *
 * 命名和 title 用英文的理由见 components/CardSprite.stories.ts 的文件头。
 */

import { Container, Graphics, Sprite, TextStyle } from 'pixi.js'
import { FONT_STACK, TextTextureCache } from '../runtime/textCache'
import { STORY_INK, STORY_PLATE, type StoryStage } from '../storyStage'
import { bakeTextures } from './bakedTextures'

/** 画布尺寸：三列三行，每格 220×260，下面留一行说明。 */
const SIZE = { width: 660, height: 780 }
const GRID = { columns: 3, cellWidth: 220, cellHeight: 260 }
/** 一张纹理在格子里最多占多大，剩下的留给说明文字。 */
const FIT = { width: 170, height: 200 }

/** 说明文字的样式。目录页自己的标签，不是组件的一部分，所以就地建。 */
function labelStyle(): TextStyle {
  return new TextStyle({
    fontFamily: FONT_STACK,
    fontSize: 12,
    fill: STORY_INK,
  })
}

/**
 * 九张纹理摆成三行三列，每张按各自的尺寸缩放到格子里。
 *
 * 有几张烤出来是白的（柔光点、费用盘底，用的时候靠 tint 上色，tint 不触发重建，符合 3.10），
 * 所以这里就按白的看：目录页要看的是形状和渐变，不是某一次调用给的颜色。
 * 卡下那团投影是黑的，底下垫一块浅色板子才看得见它化开的边。
 */
function mountBaked(ctx: StoryStage) {
  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  const style = labelStyle()

  const items = [
    { texture: baked.cardChrome, label: '边框羽化 cardChrome' },
    { texture: baked.cardShadow, label: '卡下投影 cardShadow', plate: true },
    { texture: baked.cardChromePlaque, label: '边框带匾 cardChromePlaque' },
    { texture: baked.costDisc, label: '费用盘底 costDisc' },
    { texture: baked.costRings, label: '费用金属圈 costRings' },
    { texture: baked.cardSeal, label: '问号章 cardSeal' },
    { texture: baked.cardBody, label: '兜底渐变 cardBody', plate: true },
    { texture: baked.foeBack, label: '对手牌背 foeBack' },
    { texture: baked.softDot, label: '柔光点 softDot' },
  ]

  const columns = new Container()
  ctx.stage.addChild(columns)

  items.forEach((item, index) => {
    const cx = ((index % GRID.columns) + 0.5) * GRID.cellWidth
    const top = Math.floor(index / GRID.columns) * GRID.cellHeight
    const scale = Math.min(1, FIT.width / item.texture.width, FIT.height / item.texture.height)
    const width = item.texture.width * scale
    const height = item.texture.height * scale
    const cy = top + 20 + height / 2
    if (item.plate === true) {
      const plate = new Graphics()
        .rect(cx - width / 2, cy - height / 2, width, height)
        .fill({ color: STORY_PLATE })
      columns.addChild(plate)
    }
    const sprite = new Sprite(item.texture)
    sprite.anchor.set(0.5)
    sprite.scale.set(scale)
    sprite.position.set(cx, cy)
    columns.addChild(sprite)

    const label = new Sprite(text.get(`label|${item.label}`, item.label, style))
    label.anchor.set(0.5)
    label.position.set(cx, top + GRID.cellHeight - 18)
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
 * 九张摆开看。
 *
 * 每张各按自己的尺寸缩到格子里，因为它们真实尺寸差得太远：
 * 边框是整张卡（150×225），投影比卡还大一圈，费用章只有 100 见方、显示时更是缩到 31。
 */
export const AllThree = {
  name: '九张摆开',
  parameters: {
    pixi: { ...SIZE, mount: mountBaked },
  },
}
