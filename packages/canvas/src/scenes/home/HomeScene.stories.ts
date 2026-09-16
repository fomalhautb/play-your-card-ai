/**
 * 组件目录页条目：首页（7.1 第 3 条）。
 *
 * 两条：桌面档、手机档。两档的版式算法现在是同一套（见 homeLayout.ts），
 * 差别只剩展示卡放多大，所以这两条拍的其实是「同一页在宽窄两种视口下的样子」。
 *
 * 状态矩阵：
 *   普通    「桌面档」和「手机档」两条
 *   悬停    不适用。展示卡的 hover 上浮在 CardSprite 自己的条目里拍
 *   按下    不适用。素方块没有按下的视觉态（见 Box.ts）
 *   禁用    不适用。首页上没有点不动的东西
 *   加载    不适用。这一页不再等任何图（正式版简化第 4 步删掉了那四层底图）
 *
 * 原先还有第三条「人物高亮」，随简化第 2 步删掉首页人物层一起去掉了。
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import { cardVisualOf } from '../../storyCards'
import type { StoryStage } from '../../storyStage'
import { mountHomeScene } from './HomeScene'

/*
 * 桌面档那条的画布要**宽不小于 768**，否则 `pickTier` 会判成手机档
 *（见 scenes/duel/layout/pickLayout.ts：宽窄于断点就走触屏那一档）。
 * 目录页的视口钉在 1280×900，1180×790 是在这里面摆得下的最大一档。
 */
const DESKTOP = { width: 1180, height: 790 }
const MOBILE = { width: 380, height: 720 }

function mount(ctx: StoryStage, size: { width: number; height: number }) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const faces = Object.keys(textures.faces)
  const cards = [0, 1, 2, 3].map((index) => {
    const key = faces[index % faces.length] ?? ''
    return cardVisualOf(key, index, textures.faces[key] ?? textures.back, textures.back)
  })

  const scene = mountHomeScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，这个 canvas 只是拿来对齐尺寸。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    ...size,
    resolution: ctx.resolution,
    cards,
    dev: true,
    manualClock: true,
    // 手机档靠「指针是粗的」这一条走过去，不靠视口——380 宽的画布在目录页里两条判据都成立，
    // 显式写出来是为了让这条条目自己说清它拍的是哪一档。
    coarsePointer: size === MOBILE,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  return () => scene.destroy()
}

function spec(size: { width: number; height: number }) {
  return {
    pixi: {
      ...size,
      needsAtlas: true,
      mount: (ctx: StoryStage) => mount(ctx, size),
    },
  }
}

export default {
  title: 'Canvas/HomeScene',
  render: () => null,
}

/** 桌面档：上面一排展示卡，下面一列方块。 */
export const Desktop = { name: '桌面档', parameters: spec(DESKTOP) }

/** 手机档：同一套摆法，卡小一档。 */
export const Mobile = { name: '手机档', parameters: spec(MOBILE) }
