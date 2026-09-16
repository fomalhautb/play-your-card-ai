/**
 * 组件目录页条目：选英雄页（7.1 第 3 条）。
 *
 * 四条：桌面档、指针停在某张卡上、技能详情打开、手机档。
 *
 * 状态矩阵：
 *   普通    「桌面档」「手机档」两条
 *   悬停    「卡片悬停」那条（`hoverCard` 直接摆，目录页没有真指针）
 *   按下    不适用。按下态在 PlaqueButton 自己的条目里拍
 *   禁用    「桌面档」里最后三位就是禁用档（`comingSoon` 置灰 + 敬请期待角标）
 *   加载    不适用。「图没到齐先显示进度条」那一段归装配层
 *
 * 英雄文案在这里是**目录页专用**的一份（同 storyCards.ts 的做法）：
 * 真数据来自 `content` 的 HEROES，由装配层查好传进来，而 canvas 不许 import content。
 *
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import type { Texture } from 'pixi.js'
import type { StoryStage } from '../../storyStage'
import { mountHeroScene } from './HeroScene'
import type { HeroEntry, HeroView } from './heroContract'

/* 桌面档那条的画布要宽不小于 768，理由同首页那条条目。 */
const DESKTOP = { width: 1180, height: 790 }
const MOBILE = { width: 380, height: 720 }

/** 七位英雄的 id（`content` 的 HEROES 键序）和目录页占位文案。 */
const HEROES = [
  { id: 'danqi-chen', name: '陈丹琦', enName: 'Danqi Chen', skillName: '精准检索' },
  {
    id: 'melanie-perkins',
    name: '梅拉妮·珀金斯',
    enName: 'Melanie Perkins',
    skillName: '化繁为简',
  },
  { id: 'ada-lovelace', name: '阿达·洛芙莱斯', enName: 'Ada Lovelace', skillName: '第一算法' },
  { id: 'grace-hopper', name: '格蕾丝·霍珀', enName: 'Grace Hopper', skillName: 'Debug' },
  { id: 'fei-fei-li', name: '李飞飞', enName: 'Fei-Fei Li', skillName: '再看一眼', soon: true },
  {
    id: 'mira-murati',
    name: '米拉·穆拉蒂',
    enName: 'Mira Murati',
    skillName: '快速部署',
    soon: true,
  },
  {
    id: 'margaret-hamilton',
    name: '玛格丽特·汉密尔顿',
    enName: 'Margaret Hamilton',
    skillName: '容错系统',
    soon: true,
  },
] as const

const URLS = HEROES.map((hero) => `/hero/card-${hero.id}.webp`)

async function mount(
  ctx: StoryStage,
  size: { width: number; height: number },
  view: HeroView,
  hover: number | null,
) {
  const images = await ctx.loadImages(URLS)
  // 图没下下来时顶一张空纹理，整条条目照样画得出来（同 loadImages 的兜底思路）。
  const blank = ctx.textures?.back ?? (undefined as unknown as Texture)
  const heroes: HeroEntry[] = HEROES.map((hero) => ({
    id: hero.id,
    name: hero.name,
    enName: hero.enName,
    text: '目录页占位文案：这里放人物的真实经历，长度按三四行排。',
    skillName: hero.skillName,
    skillText: '目录页占位文案：这里放技能在对局里的效果。',
    roleText: '目录页占位文案：定位。',
    ...('soon' in hero ? { comingSoon: true } : {}),
    art: images[`/hero/card-${hero.id}.webp`] ?? blank,
  }))

  const scene = mountHeroScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，这个 canvas 只是拿来对齐尺寸。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    ...size,
    resolution: ctx.resolution,
    heroes,
    manualClock: true,
    coarsePointer: size === MOBILE,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  scene.setView(view)
  scene.hoverCard(hover)
  return () => scene.destroy()
}

const CLOSED: HeroView = { selectedId: null, detailId: null, confirmable: true }

function spec(size: { width: number; height: number }, view: HeroView, hover: number | null) {
  return {
    pixi: {
      ...size,
      // 卡面图集只用来当兜底纹理（图没下下来时顶上），但要它才能保证不出现空引用。
      needsAtlas: true,
      /*
       * 推到 1400 毫秒。要等的是这几段：整页入场（三格 0.5 + 错峰，七张卡 0.1 起跑
       * 各 0.55 + 错峰 0.05，最晚一张 0.75 收尾）、悬停的上浮（0.25）、提示淡入（0.18）、
       * 详情进场（0.55）和说明淡入（0.26），外加跟指针倾斜那一路的指数收敛
       *（时间常数 0.35/3，跑满判据要三百多毫秒）。不推够的话拍到的是半路。
       */
      settleMs: 1400,
      mount: (ctx: StoryStage) => mount(ctx, size, view, hover),
    },
  }
}

export default {
  title: 'Canvas/HeroScene',
  render: () => null,
}

/** 桌面档：1672×941 死版式缩放居中，两排 4 + 3，后三位灰着并压着「敬请期待」。 */
export const Desktop = { name: '桌面档', parameters: spec(DESKTOP, CLOSED, null) }

/** 指针停在第一张上：上浮、放大、跟指针三维倾斜加一块反光，卡上沿浮出「点击查看技能」。 */
export const CardHover = { name: '卡片悬停', parameters: spec(DESKTOP, CLOSED, 0) }

/** 技能详情打开：暗幕升起、卡放到左侧、右侧摊开说明，底下两颗钮。 */
export const DetailOpen = {
  name: '详情打开',
  parameters: spec(
    DESKTOP,
    { selectedId: 'ada-lovelace', detailId: 'ada-lovelace', confirmable: true },
    null,
  ),
}

/** 手机档：3 + 2 + 2 三排，卡更大、字更大。 */
export const Mobile = { name: '手机档', parameters: spec(MOBILE, CLOSED, null) }
