/**
 * 把一张纹理烤成低分辨率的 alpha 掩码（首页人物命中判定的另一半，纯函数那半在 castHit.ts）。
 *
 * 只在**建场景时**烤一次。一次烤要走一趟「渲染到纹理 + 回读像素」，也就是 GPU 回读，
 * 这是全场最贵的一种调用之一（6.9 那张表里「同步阻塞调用」和「离屏渲染次数」量的就是它）。
 * 两条断言量的都是**剧本跑起来之后**的增量，建场景那一下不在里面；
 * 但也正因为贵，绝不能挪到指针回调里去——每帧读像素等于每帧等一次 GPU 排空。
 *
 * 缩到 `CAST_MASK_WIDTH` 再读：原图是 3344×1882，照原样读一张就是 630 万像素、25MB，
 * 七张直接把主线程钉死几百毫秒。缩到 418 宽之后一张不到 100KB，轮廓误差约 4 个屏幕像素。
 *
 * 单张失败不抛：少一个人不能 hover 是可以接受的降级，整页因此起不来不行。
 */

import { type Renderer, Sprite, type Texture } from 'pixi.js'
import { type AlphaMask, alphaBBox, CAST_MASK_WIDTH, emptyMask } from './castHit'

/**
 * 烤一张掩码。
 *
 * 用一个临时的 Sprite 而不是直接把纹理交给 `extract.pixels`：直接给纹理的话读到的是
 * **原始尺寸**，缩不下来。摆一个缩好的精灵再读，回读的就只有几万个像素。
 */
function bakeAlphaMask(renderer: Renderer, texture: Texture): AlphaMask {
  try {
    const source = texture.width
    if (source <= 0 || texture.height <= 0) return emptyMask()
    // 源图比目标还窄时按原宽读，放大只会凭空多出内存，换不来精度。
    const scale = Math.min(1, CAST_MASK_WIDTH / source)
    const sprite = new Sprite(texture)
    sprite.scale.set(scale)
    const { pixels, width, height } = renderer.extract.pixels({ target: sprite })
    sprite.destroy()
    if (width <= 0 || height <= 0) return emptyMask()

    const alpha = new Uint8Array(width * height)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3] ?? 0
    return { width, height, alpha, bbox: alphaBBox(alpha, width, height) }
  } catch {
    return emptyMask()
  }
}

/** 一次烤一组，顺序和入参一一对应。 */
export function bakeAlphaMasks(renderer: Renderer, textures: readonly Texture[]): AlphaMask[] {
  return textures.map((texture) => bakeAlphaMask(renderer, texture))
}
