/**
 * 组件目录页条目：首页（7.1 第 3 条）。
 *
 * 三条：桌面档、指针停在某个人身上、手机档。三条都摆同一批素材，差别只有视口和一次
 * `hoverCast`——这一页没有需要跑一段脚本才到得了的画面。
 *
 * 状态矩阵：
 *   普通    「桌面档」和「手机档」两条
 *   悬停    「人物高亮」那条（人物的 alpha 命中拍不出来，所以直接调 `hoverCast`）
 *   按下    不适用。按下态在 PlaqueButton / PlateButton 自己的条目里拍
 *   禁用    不适用。首页上没有点不动的东西
 *   加载    不适用。「图没到齐先显示进度条」那一段归装配层（见 client 的 HomeScreen）
 *
 * 人物文案在这里是**目录页专用**的一份（同 storyCards.ts 的做法）：真首页的七个人
 * 来自 `content` 的 HEROES，由装配层查好传进来，而 canvas 不许 import content。
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import type { Texture } from 'pixi.js'
import { cardVisualOf } from '../../storyCards'
import type { StoryStage } from '../../storyStage'
import { mountHomeScene } from './HomeScene'
import type { HomeCastMember } from './homeContract'

/*
 * 桌面档那条的画布要**短边不小于 768**，否则 `pickTier` 会判成手机档
 *（见 scenes/duel/layout/pickLayout.ts：短边窄于断点就走触屏那一档）。
 * 目录页的视口钉在 1280×900，1180×790 是在这里面摆得下的最大一档。
 */
const DESKTOP = { width: 1180, height: 790 }
const MOBILE = { width: 380, height: 720 }

/** 那幅画的各层，顺序就是七个人的叠放顺序（后排在前）。 */
const CAST_FILES = [
  'cast-left-back',
  'cast-left-officer',
  'cast-left-front',
  'cast-right-glasses',
  'cast-right-laugh',
  'cast-right-classic',
  'cast-right-front',
] as const

/** 七个人的名字和文案，目录页专用（真数据在 content 的 HEROES）。 */
const CAST_TEXT = [
  { name: '玛格丽特·汉密尔顿', skillName: '容错系统' },
  { name: '格蕾丝·霍珀', skillName: 'Debug' },
  { name: '李飞飞', skillName: '再看一眼' },
  { name: '陈丹琦', skillName: '精准检索' },
  { name: '梅拉妮·珀金斯', skillName: '化繁为简' },
  { name: '阿达·洛芙莱斯', skillName: '第一算法' },
  { name: '米拉·穆拉蒂', skillName: '快速部署' },
] as const

const LAYERS = ['home-bg', ...CAST_FILES, 'home-table', 'home-props', 'home-plaque'] as const
const URLS = LAYERS.map((file) => `/home/${file}.webp`)

/** 图没下下来时顶上的一张空纹理，让整条条目照样画得出来（同 loadImages 的兜底思路）。 */
function pick(images: Record<string, Texture>, file: string, fallback: Texture): Texture {
  return images[`/home/${file}.webp`] ?? fallback
}

async function mount(
  ctx: StoryStage,
  size: { width: number; height: number },
  hover: number | null,
) {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const images = await ctx.loadImages(URLS)
  const faces = Object.keys(textures.faces)
  const cards = [0, 1, 2, 3].map((index) => {
    const key = faces[index % faces.length] ?? ''
    return cardVisualOf(key, index, textures.faces[key] ?? textures.back, textures.back)
  })
  const cast: HomeCastMember[] = CAST_FILES.map((file, index) => ({
    id: file,
    name: CAST_TEXT[index]?.name ?? file,
    intro: '目录页占位文案：这里放人物的真实经历，长度按两三行排。',
    skillName: CAST_TEXT[index]?.skillName ?? '技能',
    skillText: '目录页占位文案：这里放技能在对局里的效果，说明这张牌什么时候用。',
    roleText: '目录页占位文案：定位。',
    art: pick(images, file, textures.back),
  }))

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
      // 静音钮那两枚剪影不传：场景会自己画一对占位（见 fx/controlIcons.ts）。
    },
    cast,
    cards,
    dev: true,
    manualClock: true,
    // 手机档靠「指针是粗的」这一条走过去，不靠视口——380 宽的画布在目录页里两条判据都成立，
    // 显式写出来是为了让这条条目自己说清它拍的是哪一档。
    coarsePointer: size === MOBILE,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  scene.hoverCast(hover)
  return () => scene.destroy()
}

function spec(size: { width: number; height: number }, hover: number | null) {
  return {
    pixi: {
      ...size,
      needsAtlas: true,
      /*
       * 推到 900 毫秒：高亮和介绍卡的淡入（0.26s 加 0.08s 延迟）早就演完，
       * 而主入口那颗匾额的浮动周期是 3.2 秒，900ms 落在它的一个固定相位上——
       * 手动时钟按 60fps 定步长推，所以每次跑停在同一帧。
       */
      settleMs: 900,
      mount: (ctx: StoryStage) => mount(ctx, size, hover),
    },
  }
}

export default {
  title: 'Canvas/HomeScene',
  render: () => null,
}

/** 桌面档：那幅画按 contain 塞满视口，菜单横排。 */
export const Desktop = { name: '桌面档', parameters: spec(DESKTOP, null) }

/** 指针停在最前排那位身上：她的发光副本亮起，右边浮出介绍卡。 */
export const CastHover = { name: '人物高亮', parameters: spec(DESKTOP, 6) }

/** 手机档：画整块缩到屏幕上半部，标题、主入口和菜单在下面竖着摞。 */
export const Mobile = { name: '手机档', parameters: spec(MOBILE, null) }
