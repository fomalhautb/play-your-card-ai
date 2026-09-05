/**
 * 剧本用的纹理。两条路：真实场景从图集加载，桩场景用程序生成的纯色卡面。
 *
 * 程序生成走 BufferImageSource：直接喂一串字节，不经过 canvas 2D。
 * 这样每台机器上的像素完全一样——用 canvas 画的话，抗锯齿和字体光栅化会让
 * 「常驻纹理内存」这类确定性指标在不同机器上差出一点来。
 */

import { tokens } from '@ai-duel/design'
import { Assets, BufferImageSource, type Spritesheet, Texture } from 'pixi.js'
import type { AtlasOptions } from './atlas'
import type { CardTextures } from './contract'

/** 卡面纹理尺寸，凑近真实卡牌的 9:12.5 比例。 */
const FACE_WIDTH = 128
const FACE_HEIGHT = 176

/** 卡面边框颜色读设计令牌，不写死（7.1 第 4 条）。这里要的是字节，所以拆成三个通道。 */
const EDGE = hexToRgb(tokens.color.paper.base)

/** '#rrggbb' → [r, g, b]。令牌是给 CSS 和 Pixi 用的字符串，写像素得自己拆。 */
function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** 把 key 揉成一个稳定的整数，用来给每张卡挑一个固定颜色。 */
function hash(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 画一张纯色带边框的卡面。
 *
 * 边框不是为了好看：不同的卡面必须是不同的纹理对象，否则 Pixi 会把它们合成一批，
 * 「纹理绑定次数」这条计数器就永远是 0，测不出合批有没有被打断。
 */
function facePixels(key: string): Uint8Array {
  const data = new Uint8Array(FACE_WIDTH * FACE_HEIGHT * 4)
  const h = hash(key)
  const r = 60 + (h & 0x7f)
  const g = 60 + ((h >>> 8) & 0x7f)
  const b = 60 + ((h >>> 16) & 0x7f)
  for (let y = 0; y < FACE_HEIGHT; y += 1) {
    for (let x = 0; x < FACE_WIDTH; x += 1) {
      const edge = x < 6 || y < 6 || x >= FACE_WIDTH - 6 || y >= FACE_HEIGHT - 6
      const i = (y * FACE_WIDTH + x) * 4
      data[i] = edge ? EDGE[0] : r
      data[i + 1] = edge ? EDGE[1] : g
      data[i + 2] = edge ? EDGE[2] : b
      data[i + 3] = 255
    }
  }
  return data
}

function textureFrom(data: Uint8Array, width: number, height: number, label: string): Texture {
  const source = new BufferImageSource({ resource: data, width, height, label })
  return new Texture({ source, label })
}

/**
 * 一组备好的纹理，外加把它还回去的办法。
 *
 * 契约里纹理是调用方加载好传给场景的，场景不会替我们销毁（见 duelContract.ts）。
 * 两条路归还的方式不一样——程序生成的直接 destroy，图集要走 Assets.unload，
 * 不然缓存里留着一份已经销毁的 Spritesheet，下一次 init 拿到的就是空纹理。
 * 所以把「怎么还」和「怎么取」放在一起返回，调用方只管调 dispose。
 */
export interface LoadedTextures {
  textures: CardTextures
  dispose(): Promise<void>
}

/** 桩场景用的纹理：牌库里每个 key 一张卡面，外加一张共用的牌背。 */
export function createProceduralTextures(deck: readonly string[]): LoadedTextures {
  const faces: Record<string, Texture> = {}
  for (const key of new Set(deck)) {
    faces[key] = textureFrom(facePixels(key), FACE_WIDTH, FACE_HEIGHT, `face:${key}`)
  }
  const back = textureFrom(facePixels('__back__'), FACE_WIDTH, FACE_HEIGHT, 'back')
  return {
    textures: { faces, back },
    dispose: async () => {
      for (const texture of Object.values(faces)) texture.destroy(true)
      back.destroy(true)
    },
  }
}

/** 1×1 纯白，给过度绘制的调试渲染用（见 page/overdraw.ts）。 */
export function createWhiteTexture(): Texture {
  return textureFrom(new Uint8Array([255, 255, 255, 255]), 1, 1, 'overdraw:white')
}

/**
 * 加载一张图集的全部页，一页一条 Assets 记录。
 *
 * 为什么不让 Pixi 自动把关联页拉进来（那是默认行为，`sheet.linkedSheets` 就是它的产物）：
 * 自动拉进来的页在 Assets 的缓存里没有自己的记录，卸的时候 `Assets.unload` 会对着它们
 * 报「不在缓存里」，一轮跑批刷几十行警告。这里改成先读第一页的 related_multi_packs、
 * 再自己把每一页作为一条记录加载（ignoreMultiPack 关掉自动拉取），装和卸就对称了。
 *
 * 页名写在第一页 json 里，是相对第一页的文件名，所以要接回第一页所在的目录。
 */
interface AtlasPages {
  pages: Spritesheet[]
  /** 每一页的清单地址，卸的时候要按它还回去。 */
  urls: string[]
}

async function loadPages(manifest: string): Promise<AtlasPages> {
  const load = (url: string) =>
    Assets.load<Spritesheet>({ src: url, data: { ignoreMultiPack: true } })
  const first = await load(manifest)
  const dir = manifest.slice(0, manifest.lastIndexOf('/') + 1)
  const related = first.data.meta.related_multi_packs
  const names = Array.isArray(related) ? related.filter((n) => typeof n === 'string') : []
  const urls = names.map((name) => `${dir}${name}`)
  const rest = await Promise.all(urls.map(load))
  return { pages: [first, ...rest], urls: [manifest, ...urls] }
}

/** 几页图集里的全部帧。同一组图集的帧名不重复，所以直接并起来。 */
function framesOf(pages: Spritesheet[]): Record<string, Texture> {
  const frames: Record<string, Texture> = {}
  for (const page of pages) Object.assign(frames, page.textures)
  return frames
}

/**
 * 真实场景用的纹理：从图集加载。图集由仓库根目录的 `pnpm assets:build` 打出来，
 * 复制到 `public/atlas/`（gitignore）。没跑过那条命令的话这里会 404。
 *
 * 只装 models 和 backs 两组，技能牌那组不装（3.4：不让纹理常驻超过当前场景所需）。
 * 这和 `packages/client` 开发页的 cardAtlas.ts 是同一套装卸口径，两边量到的常驻纹理才可比。
 */
export async function loadAtlasTextures(
  deck: readonly string[],
  opts: AtlasOptions,
): Promise<LoadedTextures> {
  const [face, backs] = await Promise.all([loadPages(opts.faces), loadPages(opts.backs)])
  const available = framesOf(face.pages)
  const faces: Record<string, Texture> = {}
  for (const key of new Set(deck)) {
    const texture = available[key]
    if (!texture) throw new Error(`图集 ${opts.faces} 里没有帧 ${key}`)
    faces[key] = texture
  }
  const back = framesOf(backs.pages)[opts.backFrame]
  if (!back) throw new Error(`图集 ${opts.backs} 里没有牌背帧 ${opts.backFrame}`)
  const urls = [...face.urls, ...backs.urls]
  return { textures: { faces, back }, dispose: () => Assets.unload(urls) }
}
