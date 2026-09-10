/**
 * 过度绘制倍数，对应 6.9 表那行「调试模式用叠加混合画一遍再读回平均值」。
 *
 * 做法：把场景里每个可见对象临时换成 1×1 白纹理、tint 0x010101、叠加混合，
 * 渲进一张 RenderTexture 再读回来。叠加混合是 `dst += src`，白纹理配 tint 1/255
 * 让每次绘制正好给红通道加 1，所以读回来的字节值本身就是「这个像素被画了几次」，
 * 平均一下就是每像素平均绘制次数。
 *
 * 这一趟是**降分辨率**渲的（见 OVERDRAW_SCALE）：读回来的是个空间平均值，对采样分辨率不敏感，
 * 缩小之后那次同步读回便宜十几倍。
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
 * - 图形（Graphics）：整份画法换成「按它自己的包围盒填一块实心白」（理由见下面第 4 条）。
 *   数得准，而且偏保守。
 * - 九宫格精灵（NineSliceSprite）：换白纹理，四条边的留白一并归零（理由见下面第 5 条）。数得准。
 * - Filter：一律摘掉，不算进来。3.1 本来就不许挂，真挂了「离屏渲染次数」那条会先报。
 * - 其它会画东西的节点（Text 之类）：外观换不掉，只能涂上 tint 1/255，
 *   画出去的仍然是原来那些深浅不一的像素，加进红通道的不是整数 1，甚至可能是 0。
 *   这种节点计进 `unswapped`。真实场景要求它是 0（tests/deterministic.spec.ts 断言了这条），
 *   桩场景每张牌带一个 Text 标签，不是 0 属于预期（src/scene/stubScene.ts）。
 */

import {
  type Container,
  type Filter,
  Graphics,
  GraphicsContext,
  Matrix,
  Mesh,
  NineSliceSprite,
  type Renderer,
  RenderTexture,
  type Shader,
  Sprite,
  type Texture,
  ViewContainer,
} from 'pixi.js'
import type { OverdrawResult } from '../metrics/types'

/**
 * 调试渲染缩到原尺寸的几分之几。每个维度四分之一，像素数就是十六分之一。
 *
 * 为什么可以缩：这条指标读回来的是「每像素平均绘制次数」，一个空间平均值。
 * 缩小之后每个四边形盖住的像素数和画布总像素数按同一个比例一起变小，比值几乎不动——
 * 实测六段剧本改前改后最多差 0.004（手机档 play10 的 0.954 → 0.958）。
 * 而这一趟的开销几乎全在下面那次同步读回上，是按像素数收费的：桌面档从 1920×1080 的 8 MB
 * 降到 480×270 的 0.5 MB，无头 SwiftShader 上实测一次 20 ms 降到 2 ms。
 *
 * 别指望靠它把跑批变快。一段剧本动作期间最多采 10 次（benchApi.ts 的 MAX_OVERDRAW_SAMPLES），
 * 加上收尾那次是 11 次，一条用例前后两轮记录也就 22 次，省下的是零点几秒；跑批的时间在场景自己的逐帧绘制上
 * （桌面 play10 三轮共四千多帧，每帧 2880×1620 的软件光栅，那才是四分多钟的来源）。
 * CPU profile 会把大量时间算在下面 extract.pixels 那一行，别信：绘制命令是异步排队的，
 * 一直攒到这里的读回才被强制刷完，profile 记在这里的其实是前面几百帧的账。
 *
 * 为什么是四分之一、不接着往下缩：场景里最细的东西是 31×31 的费用章和高 30 的名牌
 * （canvas 的 fx/bakedTextures.ts）。落地那圈亮环虽然只有 2px 厚，但它不算在内——
 * 这一趟会把网格自带的着色器换成实心的（见下面 Saved 的 shader），量到的是整个四边形，
 * 而不是着色器在里面抠出来的那圈细线。缩到四分之一费用章和名牌还占七八个像素，
 * 照样被数进来；再缩一半就只剩三四个像素，光栅化的覆盖规则会开始整块地丢掉它们，
 * 平均值就偏小了。
 */
const OVERDRAW_SCALE = 0.25

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
  /** 图形节点原来的那份画法。换成实心白之后要原样装回去。 */
  context?: GraphicsContext
  /** 九宫格精灵四条边的留白。换纹理时会被重置，所以要单独存一份。 */
  slice?: { left: number; right: number; top: number; bottom: number }
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
 *
 * 4. 图形节点（Graphics）整份画法换成「按它自己的包围盒填一块实心白」。
 *
 *    对局界面里的图形几乎都是底板和遮罩——顶栏和侧栏的板面、全屏过场的遮罩、格子的高亮圈，
 *    形状本来就是矩形或圆角矩形，包围盒和它们盖住的面积几乎一样。
 *    不换的话它们画出去的是原来那些深浅不一的像素，tint 1/255 乘上去四舍五入常常是 0，
 *    整块底板就从这条指标里消失了——而底板恰恰是填充率的大头。
 *
 *    包围盒必然大于等于真实形状，所以这一档只会**高估**过度绘制。方向是对的：
 *    这条指标是上限检查，宁可算多也别算漏。
 *
 * 5. 九宫格精灵在 Pixi v8 里**不是** Sprite 的子类，所以要单开一档。
 *
 *    换纹理之外还要把四条边的留白（leftWidth 之类）归零：留白是按原纹理的边框宽度设的，
 *    换成 1×1 之后那几个数比纹理本身还大，画出来的九宫格会散架。
 *    归零之后整块就是「中间那格拉满」，正好是一个盖住 width × height 的实心四边形。
 *    顺序也不能反——texture 的 setter 会按新纹理的默认边框重置那几个数，所以先换纹理再归零。
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
  } else if (node instanceof Graphics) {
    entry.context = node.context
  } else if (node instanceof NineSliceSprite) {
    entry.texture = node.texture
    entry.width = node.width
    entry.height = node.height
    entry.slice = {
      left: node.leftWidth,
      right: node.rightWidth,
      top: node.topHeight,
      bottom: node.bottomHeight,
    }
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
  } else if (node instanceof Graphics) {
    const box = node.getLocalBounds()
    node.context = new GraphicsContext()
      .rect(box.x, box.y, box.width, box.height)
      .fill({ color: 0xffffff })
  } else if (node instanceof NineSliceSprite) {
    node.texture = white
    node.leftWidth = 0
    node.rightWidth = 0
    node.topHeight = 0
    node.bottomHeight = 0
    if (entry.width !== undefined) node.width = entry.width
    if (entry.height !== undefined) node.height = entry.height
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
    } else if (node instanceof Graphics && entry.context !== undefined) {
      // 临时那份画法用完就扔：它是这一趟现造的，不还回去也没人再用。
      node.context.destroy()
      node.context = entry.context
    } else if (node instanceof NineSliceSprite) {
      if (entry.texture) node.texture = entry.texture
      if (entry.slice !== undefined) {
        node.leftWidth = entry.slice.left
        node.rightWidth = entry.slice.right
        node.topHeight = entry.slice.top
        node.bottomHeight = entry.slice.bottom
      }
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
  const swap = swapForOverdraw(stage, white)

  // 先把采样尺寸取整，再拿「取整后的尺寸 ÷ 原尺寸」当缩放比，而不是直接用 OVERDRAW_SCALE：
  // 手机档 390 的四分之一是 97.5，而纹理的宽高必须是整数。按实际比例缩，内容和画布缩的是
  // 同一个比例，覆盖率仍然等于原分辨率下的覆盖率，取整这一下不会把数字带偏。
  const sampleWidth = Math.max(1, Math.round(width * OVERDRAW_SCALE))
  const sampleHeight = Math.max(1, Math.round(height * OVERDRAW_SCALE))

  // resolution 固定 1：过度绘制是「每个像素被画了几次」，这个比值和渲染倍率无关，
  // 按视口的 1.5 倍去渲只是白读回更多字节。
  // 缩放也不走 resolution：Pixi 的 TextureSource 是拿 width × resolution 直接当像素宽高、
  // 不取整的，手机档传 0.25 会得到 97.5 这种非整数尺寸。尺寸只有下面这一个来源。
  const target = RenderTexture.create({
    width: sampleWidth,
    height: sampleHeight,
    resolution: 1,
    antialias: false,
  })
  try {
    // 缩放交给 render 的 transform。它是**顶替**掉 stage 自己的 localTransform 的
    // （Pixi 的 scene/container/RenderGroupSystem 直接 copyFrom），不是乘在它上面，
    // 所以要自己把 stage 那一份乘回来，否则 stage 有位移或缩放时这趟渲染会画歪。
    stage.updateLocalTransform()
    const transform = new Matrix()
      .scale(sampleWidth / width, sampleHeight / height)
      .append(stage.localTransform)
    renderer.render({ container: stage, target, transform, clear: true, clearColor: [0, 0, 0, 1] })
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
