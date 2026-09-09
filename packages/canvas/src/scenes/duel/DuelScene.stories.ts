/**
 * 组件目录页条目：对局渲染器（7.1 第 3 条）。
 *
 * 两档版式各三条关键帧——发牌完成、我方出牌飞到一半、回合结算层刚立起来。
 * 演的是一局**脚本化对局**（见 storyDuel.ts）：真引擎、真编排层、真场景，
 * 只有指令是定死的。这一条因此也是「这三样接得上」的唯一一处端到端检查。
 *
 * 状态矩阵：
 *   普通    三条关键帧，两档各一套
 *   悬停    不适用。手牌的悬停已经在 HandFan 的条目里拍过，这里拍的是整局的版式
 *   按下    不适用，同上
 *   禁用    不适用
 *   加载    「发牌」那一条就是加载态：牌正从卡堆飞进扇形
 *
 * 画布尺寸不取需求里那两块真实屏幕（1920×1080 / 390×844），而取 1280×800 和 390×844：
 * 截图回归的浏览器视口钉死在 1280×900（见 client 的 dev/storybook/playwright.config.ts），
 * 1920 宽的条目拍不进去。1280×800 的短边是 800，和 1920×1080 落在同一档
 *（断点 768，见 layout/pickLayout.ts），所以拍到的仍是桌面档那套版式。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyDeps } from '../../storyCards'
import type { StoryStage } from '../../storyStage'
import { mountDuelScene } from './DuelScene'
import { createStoryDuel, STORY_CATALOG, STORY_FRAMES } from './storyDuel'

/** 两档各自的画布尺寸，理由见文件头。 */
const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

/** 烟尘方向和大小的种子。写死才有确定性（6.9）。 */
const SEED = 20260905

function mount(ctx: StoryStage, size: { width: number; height: number }, frameMs: number) {
  const deps = storyDeps(ctx)
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')

  const scene = mountDuelScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，只用这个 canvas 订「上下文丢了」那条事件。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    width: size.width,
    height: size.height,
    resolution: ctx.resolution,
    // 目录页拍的是版式，特效开到最高档才拍得到落地那圈亮环。
    tier: 'high',
    seat: 0,
    textures,
    catalog: STORY_CATALOG,
    manualClock: true,
    // 手机档靠短边就够了，不用再假装指针是粗的。
    coarsePointer: false,
    seed: SEED,
  })
  ctx.stage.addChild(scene.root)

  // 场景的虚拟时钟挂在目录页的帧循环上：那一套才推 GSAP 的根时间线。
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  createStoryDuel(scene).runTo(frameMs, (deltaMs) => ctx.step(deltaMs))

  return () => {
    scene.destroy()
    deps.dispose()
  }
}

function spec(size: { width: number; height: number }, frameMs: number) {
  return {
    pixi: {
      ...size,
      needsAtlas: true,
      // 时间由这条条目自己在 mount 里推完（脚本化对局要一边发指令一边推），
      // 所以目录页那边不用再步进。
      settleMs: 0,
      mount: (ctx: StoryStage) => mount(ctx, size, frameMs),
    },
  }
}

export default {
  title: 'Canvas/DuelScene',
  render: () => null,
}

/** 桌面档：抛硬币收场，开局五张刚落进扇形。 */
export const DesktopDealt = {
  name: '桌面档 · 发牌完成',
  parameters: spec(DESKTOP, STORY_FRAMES.dealt),
}

/** 桌面档：我方第一张 AI 牌正从手牌飞向战场格。 */
export const DesktopPlaying = {
  name: '桌面档 · 出牌中',
  parameters: spec(DESKTOP, STORY_FRAMES.playing),
}

/** 桌面档：双方结束出牌，题目揭晓，结算层立起来。 */
export const DesktopSettling = {
  name: '桌面档 · 结算层打开',
  parameters: spec(DESKTOP, STORY_FRAMES.settling),
}

/** 手机档：侧栏折叠成顶上一行，战场缩了一档，手牌区更高。 */
export const MobileDealt = {
  name: '手机档 · 发牌完成',
  parameters: spec(MOBILE, STORY_FRAMES.dealt),
}

/** 手机档：同一段出牌演出，落点跟着缩小的战场走。 */
export const MobilePlaying = {
  name: '手机档 · 出牌中',
  parameters: spec(MOBILE, STORY_FRAMES.playing),
}

/** 手机档：结算层按设计尺寸整块缩进这块窄屏里。 */
export const MobileSettling = {
  name: '手机档 · 结算层打开',
  parameters: spec(MOBILE, STORY_FRAMES.settling),
}
