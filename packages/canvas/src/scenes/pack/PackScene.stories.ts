/**
 * 组件目录页条目：开包（7.1 第 3 条）。
 *
 * 三条对着这一页的三帧：卡背、翻到一半、翻开了。
 * 「翻到一半」是**推出来**的——把状态从 `closed` 改成 `opened` 再按固定步长推到翻面的中途，
 * 这样拍到的是真的那一帧，不是摆出来的一个假姿势。
 *
 * 状态矩阵：
 *   普通    三条，见下面
 *   悬停    不适用。素方块没有悬停的视觉态（见 Box.ts）
 *   按下    不适用，同上
 *   禁用    不适用。这一页没有点不动的东西
 *   加载    不适用
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import { cardVisualOf } from '../../storyCards'
import type { StoryStage } from '../../storyStage'
import { mountPackScene } from './PackScene'
import type { PackPhase } from './packContract'

const SIZE = { width: 460, height: 640 }

/** 翻面演 0.65 秒；推到 320 毫秒正好卡在侧对观察者那一带。 */
const MIDWAY_MS = 320

function mount(ctx: StoryStage, phase: PackPhase, flipMs: number) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const key = Object.keys(textures.faces)[3] ?? ''
  const card = cardVisualOf(key, 0, textures.faces[key] ?? textures.back, textures.back)

  const scene = mountPackScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，这个 canvas 只是拿来对齐尺寸。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    ...SIZE,
    resolution: ctx.resolution,
    manualClock: true,
    // 烟尘的方向和大小定种子，同一条条目每次跑长得一模一样（6.9 的确定性前提）。
    seed: 7,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  // 先摆成卡背：`setView` 只有在**这一步真的变了**的时候才播翻面，第一次摆是直接到位的。
  scene.setView({ phase: 'closed', card })
  if (phase === 'opened') {
    scene.setView({ phase: 'opened', card })
    // 推到翻面的某一刻。剩下的步数由目录页按 settleMs 自己推完。
    for (let t = 0; t < flipMs; t += 1000 / 60) scene.step(1000 / 60)
  }
  return () => scene.destroy()
}

function spec(phase: PackPhase, flipMs: number, settleMs: number) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs,
      mount: (ctx: StoryStage) => mount(ctx, phase, flipMs),
    },
  }
}

export default {
  title: 'Canvas/PackScene',
  render: () => null,
}

/** 还没点：卡背居中，底下一句「点一下翻开」。 */
export const Closed = { name: '卡背', parameters: spec('closed', 0, 0) }

/** 翻面途中：卡快侧过来了，正反面还没切。 */
export const Flipping = { name: '翻面中', parameters: spec('opened', MIDWAY_MS, 0) }

/**
 * 翻开了：正面朝上、命中特效放完、卡名和「继续」都出来了。
 * settleMs 推到 1600——翻面 650 加特效 800，再留一点余量让烟尘落干净。
 */
export const Opened = { name: '翻开', parameters: spec('opened', 700, 1600) }
