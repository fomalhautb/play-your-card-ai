/**
 * 剧本用的纹理。两条路：桩场景用程序生成的纯色卡面，真实场景以后从图集加载。
 *
 * 程序生成走 BufferImageSource：直接喂一串字节，不经过 canvas 2D。
 * 这样每台机器上的像素完全一样——用 canvas 画的话，抗锯齿和字体光栅化会让
 * 「常驻纹理内存」这类确定性指标在不同机器上差出一点来。
 */

import { tokens } from '@ai-duel/design'
import { Assets, BufferImageSource, type Spritesheet, Texture } from 'pixi.js'
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

/** 桩场景用的纹理：牌库里每个 key 一张卡面，外加一张共用的牌背。 */
export function createProceduralTextures(deck: readonly string[]): CardTextures {
  const faces: Record<string, Texture> = {}
  for (const key of new Set(deck)) {
    faces[key] = textureFrom(facePixels(key), FACE_WIDTH, FACE_HEIGHT, `face:${key}`)
  }
  return { faces, back: textureFrom(facePixels('__back__'), FACE_WIDTH, FACE_HEIGHT, 'back') }
}

/** 1×1 纯白，给过度绘制的调试渲染用（见 page/overdraw.ts）。 */
export function createWhiteTexture(): Texture {
  return textureFrom(new Uint8Array([255, 255, 255, 255]), 1, 1, 'overdraw:white')
}

export interface AtlasOptions {
  /** 图集所在目录，相对页面根，比如 '/atlas/'。同事的图集脚本会把文件复制到 public/atlas/。 */
  base: string
  /** 图集清单文件名（Pixi 的 spritesheet json）。 */
  manifest: string
  /** 牌背在图集里的帧名。 */
  backFrame: string
}

/**
 * 真实场景用的纹理：从图集加载。
 *
 * 现在仓库里还没有图集（public/atlas/ 被 gitignore 掉了），所以这条路暂时没人走。
 * 路径全部参数化，等图集脚本产出文件之后，页面上把 atlas 参数传进来就能切过去。
 */
export async function loadAtlasTextures(
  deck: readonly string[],
  opts: AtlasOptions,
): Promise<CardTextures> {
  const sheet = (await Assets.load(`${opts.base}${opts.manifest}`)) as Spritesheet
  const faces: Record<string, Texture> = {}
  for (const key of new Set(deck)) {
    const texture = sheet.textures[key]
    if (!texture) throw new Error(`图集 ${opts.manifest} 里没有帧 ${key}`)
    faces[key] = texture
  }
  const back = sheet.textures[opts.backFrame]
  if (!back) throw new Error(`图集 ${opts.manifest} 里没有牌背帧 ${opts.backFrame}`)
  return { faces, back }
}
