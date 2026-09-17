/**
 * 组件目录页条目：首页（7.1 第 3 条）。
 *
 * 两条：宽视口、窄视口。这一页的版式不再分档（展示卡删掉之后 tier 就没用了，
 * 见 homeLayout.ts），两条拍的是同一套摆法在宽窄两种视口下的样子——
 * 差别只剩那一列方块按视口宽算出来的宽度。
 *
 * 状态矩阵：
 *   普通    「宽视口」和「窄视口」两条
 *   悬停    不适用。素方块没有悬停的视觉态（见 Box.ts）
 *   按下    不适用。同上
 *   禁用    不适用。首页上没有点不动的东西
 *   加载    不适用。这一页不等任何图（图和展示卡都删了）
 *
 * 原先还有第三条「人物高亮」，随简化第 2 步删掉首页人物层一起去掉了。
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import type { StoryStage } from '../../storyStage'
import { mountHomeScene } from './HomeScene'

/** 目录页的视口钉在 1280×900，1180×790 是在这里面摆得下的最大一档。 */
const DESKTOP = { width: 1180, height: 790 }
const MOBILE = { width: 380, height: 720 }

function mount(ctx: StoryStage, size: { width: number; height: number }) {
  const scene = mountHomeScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，这个 canvas 只是拿来对齐尺寸。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    ...size,
    resolution: ctx.resolution,
    dev: true,
    manualClock: true,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  return () => scene.destroy()
}

function spec(size: { width: number; height: number }) {
  return {
    pixi: {
      ...size,
      mount: (ctx: StoryStage) => mount(ctx, size),
    },
  }
}

export default {
  title: 'Canvas/HomeScene',
  render: () => null,
}

/** 宽视口：一列方块摆在正中。 */
export const Desktop = { name: '宽视口', parameters: spec(DESKTOP) }

/** 窄视口：同一套摆法，那一列按视口宽窄一档。 */
export const Mobile = { name: '窄视口', parameters: spec(MOBILE) }
