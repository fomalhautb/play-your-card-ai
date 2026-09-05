/**
 * 过度绘制倍数，对应 6.9 表那行「调试模式用叠加混合画一遍再读回平均值」。
 *
 * 做法：把场景里每个可见对象临时换成 1×1 白纹理、tint 0x010101、叠加混合，
 * 渲进一张 RenderTexture 再读回来。叠加混合是 `dst += src`，白纹理配 tint 1/255
 * 让每次绘制正好给红通道加 1，所以读回来的字节值本身就是「这个像素被画了几次」，
 * 平均一下就是每像素平均绘制次数。
 *
 * 为什么换成白纹理而不是保留原图：这条指标量的是填充率，透明像素照样过片元着色器、
 * 照样耗带宽。按原图算等于把圆角、镂空的地方当没画，那就不是过度绘制了。
 *
 * 实现放在页面侧，遍历 stage 完成，不进契约——真实场景不必为了被测量而多暴露接口。
 * 它对真实场景的限制：只处理 tint / blendMode / 纹理这三样能临时改掉的属性，
 * 用了自定义 Shader、Mesh、Filter 的对象换不掉，那部分会按原样画进去，数字偏小。
 */

import {
  type Container,
  type Filter,
  type Renderer,
  RenderTexture,
  Sprite,
  type Texture,
  ViewContainer,
} from 'pixi.js'
import type { OverdrawResult } from '../metrics/types'

interface Saved {
  node: Container
  tint: number
  blendMode: Container['blendMode']
  alpha: number
  /** filters 的 getter 是只读数组、setter 要可变数组，所以存一份副本而不是原引用。 */
  filters: Filter[]
  texture?: Texture
  width?: number
  height?: number
}

/**
 * 换掉一棵树上所有节点的外观。
 *
 * 两件容易踩的事：
 *
 * 1. tint 和 alpha 在 Pixi v8 里是**逐层相乘**的，普通 Container 也有这两个属性。
 *    如果给每一层都涂上 0x010101，两层就变成 1/255 × 1/255，读回来全是 0。
 *    所以只有真正会画东西的节点（ViewContainer：精灵、图形、文字、网格）涂 1/255，
 *    中间那些容器一律恢复成「不染色、不透明、混合模式随父级」。
 *
 * 2. 精灵要额外记住换纹理前的宽高再设回去：Pixi 的 width/height 是「纹理尺寸 × 缩放」，
 *    直接把纹理换成 1×1 会让整张牌缩成一个点，覆盖面积就不是原来那块了。
 */
function disguise(node: Container, white: Texture, saved: Saved[]) {
  if (!node.visible) return
  const draws = node instanceof ViewContainer
  const entry: Saved = {
    node,
    tint: node.tint,
    blendMode: node.blendMode,
    alpha: node.alpha,
    filters: [...(node.filters ?? [])],
  }
  if (node instanceof Sprite) {
    entry.texture = node.texture
    entry.width = node.width
    entry.height = node.height
  }
  saved.push(entry)

  // Filter 每个都要一次离屏渲染，留着会把离屏那条计数也搅乱，而且它画的东西不在这棵树上。
  node.filters = []
  node.alpha = 1
  node.tint = draws ? 0x010101 : 0xffffff
  node.blendMode = draws ? 'add' : 'inherit'
  if (node instanceof Sprite && entry.width !== undefined && entry.height !== undefined) {
    node.texture = white
    node.width = entry.width
    node.height = entry.height
  }
  for (const child of node.children) disguise(child, white, saved)
}

function restore(saved: Saved[]) {
  // 倒着还原：宽高要在纹理换回去之后再设，顺序反了尺寸又会被纹理带偏。
  for (let i = saved.length - 1; i >= 0; i -= 1) {
    const entry = saved[i]
    if (!entry) continue
    const { node } = entry
    node.filters = entry.filters
    node.alpha = entry.alpha
    node.blendMode = entry.blendMode
    node.tint = entry.tint
    if (node instanceof Sprite && entry.texture) {
      node.texture = entry.texture
      if (entry.width !== undefined) node.width = entry.width
      if (entry.height !== undefined) node.height = entry.height
    }
  }
}

export function measureOverdraw(
  renderer: Renderer,
  stage: Container,
  white: Texture,
  width: number,
  height: number,
): OverdrawResult {
  const saved: Saved[] = []
  disguise(stage, white, saved)

  // 按 1 倍分辨率读回：过度绘制是「每个像素被画了几次」，这个比值和渲染倍率无关，
  // 而 1.5 倍的 1920×1080 要读回 18 MB，白等好几百毫秒。
  const target = RenderTexture.create({ width, height, resolution: 1, antialias: false })
  try {
    renderer.render({ container: stage, target, clear: true, clearColor: [0, 0, 0, 1] })
    const { pixels } = renderer.extract.pixels(target)
    let total = 0
    let peak = 0
    const count = pixels.length / 4
    for (let i = 0; i < pixels.length; i += 4) {
      const value = pixels[i] as number
      total += value
      if (value > peak) peak = value
    }
    return {
      average: count === 0 ? 0 : total / count,
      max: peak,
      sampled: count,
      nodes: saved.length,
    }
  } finally {
    restore(saved)
    target.destroy(true)
  }
}
