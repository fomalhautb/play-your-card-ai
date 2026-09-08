/**
 * 卡牌落地时绕着卡跑一圈的**金色亮环**。复刻的是旧客户端那两层 DOM：
 * `src/styles.css` 的 `.battle__tile-edge`（辉光和整层明灭）和 `.battle__tile-edge-ring`
 * （环本体：conic-gradient + 两张 mask 相减），跑法见 `src/ui/playSummonFx.ts` 的 runEdgeLight。
 *
 * 为什么自己写着色器，而不是贴一张预烤的柔光图。
 * - 纪律 3.1 不许挂 Filter，旧版那两道 drop-shadow 在 Pixi 里就是 Filter，整条路走不了；
 * - 先前试过一颗沿着卡的圆角边框跑的柔光精灵，画面上是一个模糊光斑在飞：
 *   没有环、没有沿边的拖尾、也没有辉光，和旧版一眼就能看出不是一个东西；
 * - 4.2 明确允许「自己写的中精度安全的着色器」。这里所有量都是以卡心为原点的像素，
 *   卡宽百来像素、四边形往外只扩十几像素，中间量最大也就一万出头（角上那次平方求和），
 *   离 fp16 的上限（65504）还远；而百来像素处 fp16 的一个刻度约 0.05px，
 *   远细于环带两边 0.75px 的羽化，看不出台阶。不依赖任何扩展，也没有求导。
 *
 * 混合用 normal 不用 add：旧版是普通合成（conic-gradient 画在卡上面）加两道投影，
 * 叠加混合会把卡面一起提亮，环就不再是"贴着轮廓的一圈金线"而是一团光。
 *
 * 整层的明灭直接用 Mesh 自己的 alpha，不另开 uniform：Pixi 的高级着色器模板最后一步是
 * `finalColor = outColor * vColor`，而 vColor 里已经带着这个节点的 tint 和 alpha（预乘过的），
 * 所以片元只要输出预乘 alpha，整层淡入淡出就自动成立。
 */

import {
  compileHighShaderGlProgram,
  type GlProgram,
  localUniformBitGl,
  Mesh,
  MeshGeometry,
  roundPixelsBitGl,
  Shader,
} from 'pixi.js'
import { CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'

/**
 * 环厚（像素）。来源：`.battle__tile-edge-ring` 的 `padding: 2px`——
 * 那两张 mask 相减剩下的正好是 padding 那一圈，所以 padding 就是环厚。
 * 环的内沿贴着卡的轮廓，外沿在卡外 2px（旧版靠外层 `inset: -2px` 达到同样的位置）。
 */
const RING_WIDTH = 2

/**
 * 环带两边各羽化这么宽（像素）。
 *
 * 0.75 在渲染倍率 1~1.5 上折合一到两个设备像素，够把圆弧的锯齿抹平，又不至于让 2px 的环
 * 看着发虚。不用 fwidth 自动求宽度：那要靠导数扩展，4.2 说不依赖扩展。
 */
const EDGE_FEATHER = 0.75

/**
 * 辉光够到卡外多远（像素），四边形就按「环厚 + 它」往外扩。
 *
 * 20 是按下面那档最宽的辉光算出来的：衰减到 1/255 以下（肉眼和 8 位色都分辨不出）
 * 要到 19px 上下，取整留一点余量。扩得再多只是白白多刷几圈透明像素。
 */
const GLOW_REACH = 20

/** 四边形比卡每边多出来的那一圈。 */
const OUTER = RING_WIDTH + GLOW_REACH

/**
 * 一档辉光的着色器参数：颜色（0~1）、峰值不透明度、高斯衰减系数。
 *
 * 旧版的辉光是两道 drop-shadow：各自把**环**糊开、染成自己的颜色再垫在环后面。
 * 一条宽 W、不透明度 1 的带子被标准差 σ 的高斯糊过之后，离带子 x 远处的值等于
 * 高斯在 [x, x+W] 上的积分；W 比 σ 小得多时，直接取中点那一下就够准
 * （实测和积分差不到 3%）：`W / (σ√2π) · exp(−(x + W/2)² / 2σ²)`。
 * 阴影色自带的不透明度再乘一次，峰值和衰减系数就都出来了。
 *
 * σ 直接取 drop-shadow 那个模糊半径，**不是**规范里写的一半。这是实测的：
 * 在 Chromium 里给一个方块加 `drop-shadow(0 0 20px)`，阴影降到半强度的地方在边缘外 14px，
 * 反推 σ ≈ 20.8。按 σ = 半径/2 去算，辉光会比旧版亮一倍还多——量过旧版那圈环的剖面，
 * 现在这套在离环 0~8px 的范围里和旧版对得上，误差在 3% 以内。
 */
interface Glow {
  rgb: readonly [number, number, number]
  peak: number
  falloff: number
}

/**
 * @param sigma 高斯的标准差，就是 drop-shadow 写的那个模糊半径（理由见上面）。
 * @param alpha 阴影色自带的不透明度。
 * @param rgb 阴影色的 0~255 分量。
 */
function glowOf(sigma: number, alpha: number, rgb: readonly [number, number, number]): Glow {
  return {
    rgb: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255],
    peak: (RING_WIDTH / (sigma * Math.sqrt(2 * Math.PI))) * alpha,
    falloff: 1 / (2 * sigma * sigma),
  }
}

/** 里面那道：`drop-shadow(0 0 4px rgb(255 213 121 / 70%))`。 */
const GLOW_NEAR = glowOf(4, 0.7, [255, 213, 121])
/** 外面那道：`drop-shadow(0 0 11px rgb(255 196 96 / 45%))`。 */
const GLOW_FAR = glowOf(11, 0.45, [255, 196, 96])

/**
 * 亮弧的角向渐变，抄自 `.battle__tile-edge-ring` 的 conic-gradient：
 * 0°~286° 全透明 → 330° `rgb(255 213 121 / 32%)` → 352° `rgb(255 232 176 / 88%)`
 * → 360° `rgb(255 249 226 / 100%)`。也就是一段约 74° 的亮弧带渐弱拖尾，头部近白金色。
 *
 * 角度换算成"一圈的几分之几"再进着色器：0~1 的量在中精度下刻度最细（见文件头）。
 * 0°（也就是 360°）落在 conic-gradient 的起始角上，那正是亮弧的**头部**。
 *
 * 颜色存成预乘的：CSS 的渐变本来就是在预乘空间里插值的（不然半透明段会插出一截发灰的颜色），
 * 而这个着色器输出的也是预乘 alpha，两边正好对上，直接线性插值就是对的。
 */
interface Stop {
  turn: number
  /** 预乘之后的 rgba，四个分量都是 0~1。 */
  premultiplied: readonly [number, number, number, number]
}

function stopOf(deg: number, rgb: readonly [number, number, number], alpha: number): Stop {
  return {
    turn: deg / 360,
    premultiplied: [(rgb[0] / 255) * alpha, (rgb[1] / 255) * alpha, (rgb[2] / 255) * alpha, alpha],
  }
}

/**
 * 四个停靠点。第一个是拖尾的起点（全透明），最后一个是亮弧的头部。
 * 0°~286° 那一整段都是同一个全透明色，着色器里靠对 286° 之前的比例做钳位一并盖掉。
 */
const STOPS: readonly Stop[] = [
  stopOf(286, [255, 213, 121], 0),
  stopOf(330, [255, 213, 121], 0.32),
  stopOf(352, [255, 232, 176], 0.88),
  stopOf(360, [255, 249, 226], 1),
]

/** 把数写进 GLSL 源码：定长小数，免得指数写法（1e-7）在 GLSL ES 里不合法。 */
function num(value: number): string {
  return value.toFixed(6)
}

function vec3Lit(rgb: readonly [number, number, number]): string {
  return `vec3(${num(rgb[0])}, ${num(rgb[1])}, ${num(rgb[2])})`
}

function stopLit(index: number): string {
  const c = STOPS[index]!.premultiplied
  return `vec4(${num(c[0])}, ${num(c[1])}, ${num(c[2])}, ${num(c[3])})`
}

/** 两个停靠点之间那一段的倒数长度，着色器里拿它把角度换成 0~1 的插值比例。 */
function spanInv(from: number, to: number): string {
  return num(1 / (STOPS[to]!.turn - STOPS[from]!.turn))
}

/**
 * 片元着色器。
 *
 * 输入：
 *   uRingSize   四边形的宽高（像素）。片元靠它把 0~1 的 UV 还原成以卡心为原点的像素坐标。
 *   uRingShape  卡的半宽、半高、圆角半径（像素）。圆角矩形的有符号距离场按它算。
 *   uRingTurn   亮弧头部此刻转到哪儿了，一圈记 1。每帧只改这一个。
 * 输出：预乘 alpha 的颜色。整层的不透明度由 Mesh 自己的 alpha 乘上去（见文件头）。
 */
const ringBit = {
  name: 'edge-ring-bit',
  fragment: {
    header: /* glsl */ `
        uniform vec2 uRingSize;
        uniform vec3 uRingShape;
        uniform float uRingTurn;
    `,
    main: /* glsl */ `
            vec2 p = (vUV - vec2(0.5)) * uRingSize;

            // 卡轮廓的圆角矩形有符号距离：负数在卡内，正数在卡外，0 正好压在卡的边上。
            vec2 q = abs(p) - (uRingShape.xy - vec2(uRingShape.z));
            float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uRingShape.z;

            // 环带：内沿贴卡的轮廓（d = 0），外沿在卡外 ${num(RING_WIDTH)}，两头各羽化半格。
            float band = clamp(d / ${num(EDGE_FEATHER)} + 0.5, 0.0, 1.0)
              * clamp((${num(RING_WIDTH)} - d) / ${num(EDGE_FEATHER)} + 0.5, 0.0, 1.0);
            // 离环带多远。环里侧和外侧都算——旧版的 drop-shadow 也是朝两边一起糊的。
            float away = max(-d, 0.0) + max(d - ${num(RING_WIDTH)}, 0.0);

            // 片元在卡心的哪个方向：从正上方起、顺时针记，一圈为 1（和 conic-gradient 同口径）。
            // 减去当前起始角再取小数部分，就是它落在渐变的第几分之几上。
            float turn = fract(atan(p.x, -p.y) * 0.159155 - uRingTurn);
            vec4 arc = mix(
              vec4(0.0),
              ${stopLit(1)},
              clamp((turn - ${num(STOPS[0]!.turn)}) * ${spanInv(0, 1)}, 0.0, 1.0)
            );
            arc = mix(
              arc,
              ${stopLit(2)},
              clamp((turn - ${num(STOPS[1]!.turn)}) * ${spanInv(1, 2)}, 0.0, 1.0)
            );
            arc = mix(
              arc,
              ${stopLit(3)},
              clamp((turn - ${num(STOPS[2]!.turn)}) * ${spanInv(2, 3)}, 0.0, 1.0)
            );

            // 两档辉光：形状是环带糊开的高斯，浓淡跟着亮弧走，颜色是各自那道投影的颜色。
            // 距离要往环带里推半格：高斯是从环带的**中线**摊开的，而 away 是从边沿量的。
            float mid = away + ${num(RING_WIDTH / 2)};
            // 变量别叫 near / far：那两个词在某些 GLSL 方言里是保留字，编译期才炸。
            float inner = arc.a * ${num(GLOW_NEAR.peak)}
              * exp(-mid * mid * ${num(GLOW_NEAR.falloff)});
            float outer = arc.a * ${num(GLOW_FAR.peak)}
              * exp(-mid * mid * ${num(GLOW_FAR.falloff)});
            vec4 nearGlow = vec4(${vec3Lit(GLOW_NEAR.rgb)} * inner, inner);
            vec4 farGlow = vec4(${vec3Lit(GLOW_FAR.rgb)} * outer, outer);
            vec4 ring = arc * band;

            // 三层从后往前叠，和 CSS 那条 filter 链的次序一样：外辉光、内辉光、环本体。
            // 预乘 alpha 的合成就是 src + dst × (1 − src.a)。
            vec4 halo = nearGlow + farGlow * (1.0 - nearGlow.a);
            outColor = ring + halo * (1.0 - ring.a);
    `,
  },
}

/**
 * 着色器程序全场只编译一次。现在每局只有一圈环，但这条约定要立在这儿：
 * 6.9 的「预热后着色器编译 = 0」经不起"每个实例编一次"。
 */
let program: GlProgram | null = null

function ringProgram(): GlProgram {
  program ??= compileHighShaderGlProgram({
    name: 'edge-ring',
    // 这三块是 Pixi 给 Mesh 用的标配：局部变换和颜色、像素对齐。缺了 Mesh 画不出来。
    bits: [localUniformBitGl, ringBit, roundPixelsBitGl],
  })
  return program
}

/**
 * 单位四边形：顶点 ±0.5、UV 0~1。真实尺寸靠 Mesh 的 scale 撑开，
 * 所以换一张大小不同的卡也不用重建几何（3.10 稳态每帧零堆分配）。
 */
function unitQuad(): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
}

/**
 * 一圈落地亮环。摆在特效层里，位置取卡的**中心**。
 *
 * 一个 HitFx 只建一个，反复用：每次落地先 setCard 量好这张卡，再逐帧 setTurn 转起来。
 */
export class EdgeRing extends Mesh<MeshGeometry, Shader> {
  /** 卡的半宽、半高、圆角半径。留引用免得每次量卡都去查表。 */
  private readonly shape: Float32Array
  /** 四边形的宽高。 */
  private readonly size: Float32Array

  constructor() {
    const shape = new Float32Array([0, 0, 0])
    const size = new Float32Array([0, 0])
    super({
      geometry: unitQuad(),
      shader: new Shader({
        glProgram: ringProgram(),
        resources: {
          ringUniforms: {
            uRingSize: { value: size, type: 'vec2<f32>' },
            uRingShape: { value: shape, type: 'vec3<f32>' },
            uRingTurn: { value: 0, type: 'f32' },
          },
        },
      }),
    })
    this.shape = shape
    this.size = size
    this.label = 'edge-ring'
    this.alpha = 0
    /*
     * 不演的时候整个藏起来，不能只把 alpha 归零。
     * Pixi 判要不要画看的是 visible 不是 alpha；而它带自己的着色器，一进绘制队列
     * 就是一次单独的绘制调用加前后两次状态切换（3.9），不演的那些帧不该有这笔开销。
     */
    this.visible = false
    // 它只是画面，挡住手牌就没法出牌了。
    this.eventMode = 'none'
  }

  /**
   * 量一张宽 width 高 height 的卡（都是特效层里的像素，也就是卡在屏幕上的实际大小）。
   *
   * 圆角**不是**独立配的：卡面原画、代码画的边框、这圈环必须是同一个轮廓，差一点点就会在
   * 转角处露馅。所以半径由令牌的 CARD_RADIUS 按 width / CARD_WIDTH 等比缩放，
   * 再按 min(w, h) / 2 兜一次底——半径大过短边的一半时圆角矩形会退化成胶囊，
   * 距离场算出来的形状就不是卡了。
   */
  setCard(width: number, height: number): void {
    this.shape[0] = width / 2
    this.shape[1] = height / 2
    this.shape[2] = Math.min((CARD_RADIUS * width) / CARD_WIDTH, Math.min(width, height) / 2)
    const quadWidth = width + 2 * OUTER
    const quadHeight = height + 2 * OUTER
    this.size[0] = quadWidth
    this.size[1] = quadHeight
    this.scale.set(quadWidth, quadHeight)
    this.shader?.resources.ringUniforms.update()
  }

  /** 亮弧的头部转到哪儿了，一圈记 1。逐帧只改这一个数。 */
  setTurn(turn: number): void {
    const uniforms = this.shader?.resources.ringUniforms
    if (uniforms === undefined) return
    uniforms.uniforms.uRingTurn = turn
    uniforms.update()
  }

  /**
   * 拆环。
   *
   * 几何和着色器都要手动收：Pixi 的 `Mesh.destroy` 只把引用置空，不动它们
   * （两者本来就允许多个 Mesh 共用，它没法替调用方决定）。这两样都是这一个实例独有的。
   * 着色器**程序**不销毁——那是全场共用的一份（见上面的 ringProgram）。
   */
  override destroy(options?: Parameters<Mesh['destroy']>[0]): void {
    this.geometry?.destroy()
    this.shader?.destroy()
    super.destroy(options)
  }
}
