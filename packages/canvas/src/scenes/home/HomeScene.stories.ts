/**
 * 组件目录页条目：首页（7.1 第 3 条）。
 *
 * 两条：桌面档、手机档。两条都摆同一批素材，差别只有视口——这一页没有需要跑一段脚本
 * 才到得了的画面。
 *
 * 状态矩阵：
 *   普通    「桌面档」和「手机档」两条
 *   悬停    不适用。展示卡的 hover 上浮在 CardSprite 自己的条目里拍
 *   按下    不适用。按下态在 PlaqueButton / PlateButton 自己的条目里拍
 *   禁用    不适用。首页上没有点不动的东西
 *   加载    不适用。「图没到齐先显示一行进度」那一段归装配层（见 client 的 HomeScreen）
 *
 * 原先还有第三条「人物高亮」，随简化第 2 步删掉首页人物层一起去掉了。
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import type { Texture } from 'pixi.js'
import { cardVisualOf } from '../../storyCards'
import type { StoryStage } from '../../storyStage'
import { mountHomeScene } from './HomeScene'

/*
 * 桌面档那条的画布要**短边不小于 768**，否则 `pickTier` 会判成手机档
 *（见 scenes/duel/layout/pickLayout.ts：短边窄于断点就走触屏那一档）。
 * 目录页的视口钉在 1280×900，1180×790 是在这里面摆得下的最大一档。
 */
const DESKTOP = { width: 1180, height: 790 }
const MOBILE = { width: 380, height: 720 }

const LAYERS = ['home-bg', 'home-table', 'home-props', 'home-plaque'] as const
const URLS = LAYERS.map((file) => `/home/${file}.webp`)

/** 图没下下来时顶上的一张空纹理，让整条条目照样画得出来（同 loadImages 的兜底思路）。 */
function pick(images: Record<string, Texture>, file: string, fallback: Texture): Texture {
  return images[`/home/${file}.webp`] ?? fallback
}

async function mount(ctx: StoryStage, size: { width: number; height: number }) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const images = await ctx.loadImages(URLS)
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
    textures: {
      background: pick(images, 'home-bg', textures.back),
      table: pick(images, 'home-table', textures.back),
      props: pick(images, 'home-props', textures.back),
      plaque: pick(images, 'home-plaque', textures.back),
    },
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
      /*
       * 推到 900 毫秒：主入口那颗匾额的浮动周期是 3.2 秒，900ms 落在它的一个固定相位上——
       * 手动时钟按 60fps 定步长推，所以每次跑停在同一帧。
       */
      settleMs: 900,
      /*
       * 单张截图给 150 秒，统一那档 45 秒对这两条不够（第 29、30 条第一次生成 linux 基线时
       * 就是在这里超时的）。删掉人物层之后这一页轻了不少（少传七张整幅图、少烤九张
       * alpha 掩码），但仍是目录页里最重的一条：建场景还要传四张 3344×1882 的整幅图。
       * CI 那台跑机上 WebGL 走的是 SwiftShader（纯 CPU 软件光栅），这活比本机慢一个量级，
       * 而 Playwright 判「元素稳定」等的是合成器真出两帧，排在这批活后面就得一起等。
       * 本机（macOS）两条都在几百毫秒内拍完，所以这个数只是给慢机器留的上限，平时碰不到。
       */
      screenshotTimeoutMs: 150_000,
      mount: (ctx: StoryStage) => mount(ctx, size),
    },
  }
}

export default {
  title: 'Canvas/HomeScene',
  render: () => null,
}

/** 桌面档：那幅画按 contain 塞满视口，菜单横排。 */
export const Desktop = { name: '桌面档', parameters: spec(DESKTOP) }

/** 手机档：画整块缩到屏幕上半部，标题、主入口和菜单在下面竖着摞。 */
export const Mobile = { name: '手机档', parameters: spec(MOBILE) }
