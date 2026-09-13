/**
 * 组件目录页条目共用的那点样板：烤纹理、建文字缓存、从图集里取几张卡。
 *
 * 只服务 `*.stories.ts`，不进包入口。抽出来是因为对局那批复合组件（侧栏、战场、展示层、
 * 结算层）每条条目都要先摆几张真卡，各写一遍的话同一段十来行的代码会出现十次，
 * 改图集取法时要改十处。
 *
 * 卡面数据由本文件末尾那段按贴图名推出来，**只服务目录页**：真对局的卡名和费用来自卡池
 *（见 scenes/duel/cardVisuals.ts）。目录页拍的是组件的样子，不该为了摆几张卡先造一份卡池。
 */

import { createFakePlatform, type Platform, type SoundSpec } from '@ai-duel/platform'
import type { Texture } from 'pixi.js'
import { CardSprite, type CardVisual } from './components/CardSprite'
import { type BakedTextures, bakeTextures } from './fx/bakedTextures'
import { TextTextureCache } from './runtime/textCache'
import type { StoryStage } from './storyStage'

/** 一条条目要用到的全部依赖，外加一个把它们一起收掉的函数。 */
export interface StoryDeps {
  baked: BakedTextures
  text: TextTextureCache
  animator: StoryStage['animator']
  platform: Platform
  clickSound: SoundSpec | null
  dispose(): void
}

/**
 * 目录页用假平台，不用浏览器那套实现。
 *
 * 触感和音效在截图里都看不见，而真实现要碰浏览器 API——目录页跑在无头浏览器里，
 * 让它去要振动权限、去解码一段音频，只会在控制台刷一片警告，还多一份不确定性。
 * `createFakePlatform` 本来就是给测试和 bench 剧本用的，这里直接借来。
 */
const SILENT_PLATFORM: Platform = createFakePlatform()

/** 烤好这条条目要的那批纹理和文字缓存。返回的 `dispose` 交给条目的清理函数。 */
export function storyDeps(ctx: StoryStage): StoryDeps {
  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  return {
    baked,
    text,
    animator: ctx.animator,
    platform: SILENT_PLATFORM,
    clickSound: null,
    dispose() {
      baked.destroy()
      text.destroy()
    },
  }
}

/**
 * 从图集里按顺序取第 index 张卡，建成一个 `CardSprite`。
 *
 * 图集里的贴图名是有序的（`Object.keys` 对字符串键按插入序），所以同一个 index
 * 在任何机器上取到的都是同一张——截图比对要的就是这个（6.9 的确定性前提）。
 * 超出张数就绕回开头，条目要几张就给几张。
 */
export function storyCard(ctx: StoryStage, deps: StoryDeps, index: number): CardSprite {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const keys = Object.keys(textures.faces)
  const key = keys[index % keys.length]
  const face = key === undefined ? undefined : textures.faces[key]
  if (key === undefined || face === undefined) throw new Error('图集里一张卡面都没有')
  return new CardSprite(cardVisualOf(key, index, face, textures.back), {
    baked: deps.baked,
    text: deps.text,
    // 目录页不开卡面反光：它跟着指针走，而截图里没有指针，建了也只是白占一份着色器。
    glare: false,
    // 投影是静态的，卡面长什么样的一部分，目录页照拍。
    shadow: true,
  })
}

/** 第 index 张卡在图集里叫什么（铭牌上印的那个名字）。结果卡那几条要拿它当模型名。 */
export function storyCardName(ctx: StoryStage, index: number): string {
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')
  const keys = Object.keys(textures.faces)
  const key = keys[index % keys.length] ?? ''
  const face = textures.faces[key]
  if (face === undefined) throw new Error('图集里一张卡面都没有')
  return cardVisualOf(key, index, face, textures.back).name
}

/*
 * ---------- 目录页专用的卡面数据 ----------
 *
 * 从「一串图集里的贴图名」推出一张卡的展示数据。真对局的卡名和费用来自卡池
 *（见 scenes/duel/cardVisuals.ts），而目录页要的只是「一批看着像真牌、每次都一样的卡」——
 * 它不该为了摆几张卡先造一份卡池出来。
 *
 * 推导必须是确定性的：同一个贴图名永远得到同一个费用和同一种颜色，
 * 截图比对才比得动（6.9 的确定性前提）。
 */

/** 费用的取值范围，和 core 里那批卡的费用区间对齐。 */
const MIN_COST = 1
const MAX_COST = 8

/**
 * 圆章底色的备选。取自设计令牌的主题色板——目录页没有每张原画的采样色，
 * 按贴图名稳定地挑一个，至少能让相邻的几张牌颜色分得开。
 */
const ACCENT_PALETTE = [0x46584b, 0x87502d, 0x304e70, 0x655580, 0x37646b, 0x95465f, 0x3d4a64]

/**
 * 雕花铭牌上那行技能名的备选。
 *
 * 目录页要拍的是「匾上两行字排得开吗」，所以这几条特意长短不一（四字到七字）：
 * 全用四个字的话，`textLength` 那条压窄的分支永远拍不到。
 * 真对局的技能名来自卡池（core 的 `AiCard.skillName`）。
 */
const SKILL_PALETTE = ['开天辟地', '多模感知', '统筹推演', '长思短答', '深度检索推演']

/**
 * 把贴图名摊成一个 32 位整数。
 *
 * 用 FNV-1a，只求"不同名字分得开"，不需要抗碰撞——撞了也只是两张牌费用一样。
 * 和旧客户端 cardArt.ts 挑占位图用的是同一套哈希，行为可以对着比。
 */
function hashOf(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // >>> 0 把 32 位有符号结果转成无符号，省掉负数取模那一层判断。
  return hash >>> 0
}

/**
 * 贴图名转成印在铭牌上的名字：连字符换空格，每段首字母大写。
 * `gpt-4o` → `Gpt 4o`。目录页够用，真对局读卡池里的正式卡名。
 */
function displayNameOf(key: string): string {
  return key
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * 建一张卡的展示数据。
 *
 * @param key 图集里的贴图名。
 * @param instance 同一个贴图名在一条条目里可能出现好几次，所以牌的 id 要再带一个序号，
 *   否则扇形按 id 认牌时两张会互相顶掉。
 */
export function cardVisualOf(
  key: string,
  instance: number,
  face: Texture,
  back: Texture,
): CardVisual {
  const hash = hashOf(key)
  const accent = ACCENT_PALETTE[hash % ACCENT_PALETTE.length] ?? ACCENT_PALETTE[0] ?? 0x304e70
  const skillName = SKILL_PALETTE[(hash >>> 16) % SKILL_PALETTE.length] ?? SKILL_PALETTE[0] ?? ''
  return {
    instanceId: `${key}#${instance}`,
    name: displayNameOf(key),
    cost: MIN_COST + ((hash >>> 8) % (MAX_COST - MIN_COST + 1)),
    face,
    back,
    accent,
    // 目录页的样例卡一律按「具名 AI 牌」那一档拍：三档里只有它把匾、费用章、两行字都画全了。
    skillName,
  }
}
