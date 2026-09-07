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
 *
 * 它对真实场景的限制，也就是哪些节点数得准：
 *
 * - 精灵：换白纹理，再把换之前的宽高填回去（理由见下面第 2 条）。数得准。
 * - 网格：先摘掉自带的着色器再换白纹理（理由见下面第 3 条）。数得准。
 * - Filter：一律摘掉，不算进来。3.1 本来就不许挂，真挂了「离屏渲染次数」那条会先报。
 * - 其它会画东西的节点（Graphics、Text 之类）：外观换不掉，只能涂上 tint 1/255，
 *   画出去的仍然是原来那些深浅不一的像素，加进红通道的不是整数 1，甚至可能是 0。
 *   这种节点计进 `unswapped`。真实场景要求它是 0（tests/deterministic.spec.ts 断言了这条），
 *   桩场景每张牌带一个 Text 标签，不是 0 属于预期（src/scene/stubScene.ts）。
 */

import {
  type Container,
  type Filter,
  Mesh,
  type Renderer,
  RenderTexture,
  type Shader,
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
  /**
   * 网格自带的着色器。普通贴图网格本来就是 null，所以「存过」和「存的是 null」长得一样，
   * 还原时要按节点类型判断，不能拿这个字段非不非空当依据。
   */
  shader?: Shader | null
  width?: number
  height?: number
}

/** swapForOverdraw 的产物，原样交回 restoreAfterOverdraw。 */
interface OverdrawSwap {
  /** 每个动过的节点的原样，还原时倒着走。 */
  saved: Saved[]
  /** 外观换不掉的可见节点数，含义见文件头。 */
  unswapped: number
}

/**
 * 换掉一棵树上所有节点的外观。
 *
 * 三件容易踩的事：
 *
 * 1. tint 和 alpha 在 Pixi v8 里是**逐层相乘**的，普通 Container 也有这两个属性。
 *    如果给每一层都涂上 0x010101，两层就变成 1/255 × 1/255，读回来全是 0。
 *    所以只有真正会画东西的节点（ViewContainer：精灵、图形、文字、网格）涂 1/255，
 *    中间那些容器一律恢复成「不染色、不透明、混合模式随父级」。
 *
 * 2. 精灵要额外记住换纹理前的宽高再设回去：Pixi 的 width/height 是「纹理尺寸 × 缩放」，
 *    靠 scale 撑大的精灵一换成 1×1 纹理就缩成一个点，覆盖面积就不是原来那块了。
 *    网格反过来不用管宽高——它的形状由几何的顶点定，和纹理尺寸无关。
 *
 * 3. 网格要连自带的着色器一起摘掉，而且必须先摘着色器、后换纹理。
 *
 *    卡牌各层是 PerspectiveMesh 而不是精灵（canvas 的 components/CardSprite.ts）。
 *    其中卡面反光那一层带自己的着色器（canvas 的 fx/cardGlare.ts）：它不采样纹理，
 *    自己算一个渐变 alpha 输出，最大 0.4。tint 是会乘上去的（Pixi 的着色器模板末尾是
 *    `finalColor = outColor * vColor`），可 1/255 × 0.4 写进 RGBA8 四舍五入就是 0——
 *    这一整层会被静默漏掉，结果里连个痕迹都没有。
 *
 *    摘掉着色器之后，网格走 Pixi 的合批管线，当一个普通贴图四边形画，盖到的每个像素
 *    正好加 1。这在语义上也才是对的：填充率看的是四边形盖住多少像素、每个片元跑了一遍
 *    着色器，和着色器最后输出什么颜色无关。
 *
 *    顺序不能反，是因为网格的 texture setter 在着色器还挂着的时候会把新纹理一并写进
 *    `shader.texture`（Pixi 的 scene/mesh/shared/Mesh）。先把 shader 摘成 null，
 *    整趟调试渲染就一次都不会碰到原着色器；还原时反过来，先设回纹理再把着色器装回去。
 */
function disguise(node: Container, white: Texture, swap: OverdrawSwap) {
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
  } else if (node instanceof Mesh) {
    entry.texture = node.texture
    entry.shader = node.shader
  } else if (draws) {
    swap.unswapped += 1
  }
  swap.saved.push(entry)

  // Filter 每个都要一次离屏渲染，留着会把离屏那条计数也搅乱，而且它画的东西不在这棵树上。
  node.filters = []
  node.alpha = 1
  node.tint = draws ? 0x010101 : 0xffffff
  node.blendMode = draws ? 'add' : 'inherit'
  if (node instanceof Sprite) {
    node.texture = white
    if (entry.width !== undefined) node.width = entry.width
    if (entry.height !== undefined) node.height = entry.height
  } else if (node instanceof Mesh) {
    node.shader = null
    node.texture = white
  }
  for (const child of node.children) disguise(child, white, swap)
}

/**
 * 把一棵树换成「每画一次加 1」的样子，返回还原要用的东西。
 *
 * 导出只是为了让单测（test/overdraw.test.ts）能直接验这对操作——它是纯场景图操作，
 * 不需要 WebGL。跑批一律只走 measureOverdraw。
 */
export function swapForOverdraw(root: Container, white: Texture): OverdrawSwap {
  const swap: OverdrawSwap = { saved: [], unswapped: 0 }
  disguise(root, white, swap)
  return swap
}

/** swapForOverdraw 的逆操作，把每个节点恢复原样。导出理由同上。 */
export function restoreAfterOverdraw(swap: OverdrawSwap) {
  const { saved } = swap
  // 倒着还原：宽高要在纹理换回去之后再设，顺序反了尺寸又会被纹理带偏。
  for (let i = saved.length - 1; i >= 0; i -= 1) {
    const entry = saved[i]
    if (!entry) continue
    const { node } = entry
    node.filters = entry.filters
    node.alpha = entry.alpha
    node.blendMode = entry.blendMode
    node.tint = entry.tint
    if (node instanceof Sprite) {
      if (entry.texture) node.texture = entry.texture
      if (entry.width !== undefined) node.width = entry.width
      if (entry.height !== undefined) node.height = entry.height
    } else if (node instanceof Mesh) {
      // 和换的时候反过来：先设回纹理，再把着色器装回去，同样是为了不碰原着色器。
      if (entry.texture) node.texture = entry.texture
      node.shader = entry.shader ?? null
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
  const swap = swapForOverdraw(stage, white)

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
      nodes: swap.saved.length,
      unswapped: swap.unswapped,
    }
  } finally {
    restoreAfterOverdraw(swap)
    target.destroy(true)
  }
}
