/**
 * 组件目录页条目共用的那点样板：烤纹理、建文字缓存、从图集里取几张卡。
 *
 * 只服务 `*.stories.ts`，不进包入口。抽出来是因为对局那批复合组件（侧栏、战场、展示层、
 * 结算层）每条条目都要先摆几张真卡，各写一遍的话同一段十来行的代码会出现十次，
 * 改图集取法时要改十处。
 *
 * 卡面数据走 `scenes/deckCards.ts` 那座原型专用的临时桥（接上 content 之后它会整个删掉），
 * 目录页和对局原型因此看到的是同一批卡名和费用，两边的截图能对着比。
 */

import { createFakePlatform, type Platform, type SoundSpec } from '@ai-duel/platform'
import { CardSprite } from './components/CardSprite'
import { type BakedTextures, bakeTextures } from './fx/bakedTextures'
import { bakeUiTextures, type UiTextures } from './fx/uiTextures'
import { TextTextureCache } from './runtime/textCache'
import { cardVisualOf } from './scenes/deckCards'
import type { StoryStage } from './storyStage'

/** 一条条目要用到的全部依赖，外加一个把它们一起收掉的函数。 */
export interface StoryDeps {
  ui: UiTextures
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

/** 烤好这条条目要的两批纹理和文字缓存。返回的 `dispose` 交给条目的清理函数。 */
export function storyDeps(ctx: StoryStage): StoryDeps {
  const ui = bakeUiTextures(ctx.renderer)
  const baked = bakeTextures(ctx.renderer)
  const text = new TextTextureCache(ctx.renderer)
  return {
    ui,
    baked,
    text,
    animator: ctx.animator,
    platform: SILENT_PLATFORM,
    clickSound: null,
    dispose() {
      ui.destroy()
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
