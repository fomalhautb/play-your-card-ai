/**
 * 卡面覆膜上那一小块跟着指针跑的反光。抄的是旧客户端 styles.css 里的 `.card-glare`：
 * 卡内的径向渐变、被卡的圆角裁掉、只在跟随期间淡入淡出。
 *
 * 为什么要自己写着色器，而不是贴一张预烤的柔光图：
 * - 纪律 3.1 不许挂 Filter，而 Pixi v8 里 soft-light、overlay 这些「高级混合模式」
 *   正是用 Filter 实现的（要离屏），所以旧版那条路整条走不了；
 * - 换成一张 add 混合的柔光精灵试过，那张图是矩形的、不跟着卡的圆角裁，
 *   反光会伸出卡边，看着像一块浮在卡上的圆盘，而不是覆膜上的反光；
 * - 4.2 明确允许「自己写的中精度安全的着色器」。这里所有计算都在按卡宽归一的坐标里做，
 *   数值全在 ±2 以内，mediump 绰绰有余，也不依赖任何扩展。
 *
 * 混合用 `screen` 而不是旧版的 soft-light：screen 是 Pixi 原生支持的混合模式（不走 Filter），
 * 效果是「朝白色插值」，比 soft-light 提得狠一截，所以整体不透明度要压低来找回
 * 覆膜那种哑光反光的观感（压多少由调用方给，见 components/cardTilt.ts 的 GLARE_ALPHA）。
 */

import {
  compileHighShaderGlProgram,
  type GlProgram,
  localUniformBitGl,
  Mesh,
  type PerspectivePlaneGeometry,
  roundPixelsBitGl,
  Shader,
} from 'pixi.js'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'

/** 卡高比卡宽。着色器里用它把 0~1 的 UV 拉回等比，圆角才不会被压成椭圆。 */
const ASPECT = CARD_HEIGHT / CARD_WIDTH

/**
 * 渐变的几何和亮度，全部抄自旧版 `.card-glare` 那条 radial-gradient：
 * `circle 400px at (x,y)`，白 40% → 22% 处 12% → 60% 处 0。
 * 长度一律按卡宽归一（卡宽 150），所以 400px 就是 400/150。
 */
const GRADIENT_RADIUS = 400 / CARD_WIDTH
const STOP_MID = 0.22 * GRADIENT_RADIUS
const STOP_END = 0.6 * GRADIENT_RADIUS
const ALPHA_CORE = 0.4
const ALPHA_MID = 0.12

/**
 * 圆角边缘的羽化宽度（同样按卡宽归一）。
 *
 * 0.004 在 hover 放大约 1.9 倍、渲染倍率 1.5 的桌面档上折合不到一个设备像素，
 * 既看不出是渐变，又足够把圆弧的锯齿抹平。不用 fwidth 自动求宽度：
 * 那要靠导数扩展，4.2 说不依赖扩展。
 */
const EDGE_FEATHER = 0.004

/**
 * 片元着色器的那一段。
 *
 * 工作坐标 p：把 0~1 的 UV 挪到以卡心为原点、再按卡的长宽比拉开，于是卡面占
 * x ∈ [−0.5, 0.5]、y ∈ [−0.75, 0.75]，一个单位就是一个卡宽。
 * 圆角矩形用标准的有符号距离场：dist ≤ 0 在卡内，> 0 在卡外，正好拿来做裁剪。
 */
const glareBit = {
  name: 'card-glare-bit',
  fragment: {
    header: /* glsl */ `
        uniform vec2 uGlareCenter;
        uniform vec4 uGlareStops;
        uniform vec3 uGlareShape;
    `,
    main: /* glsl */ `
            vec2 p = (vUV - vec2(0.5)) * vec2(1.0, uGlareShape.y * 2.0);

            // 圆角矩形的有符号距离，超出卡外就淡出到 0（羽化一小段，边缘才不是锯齿）。
            vec2 q = abs(p) - (uGlareShape.xy - vec2(uGlareShape.z));
            float dist = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uGlareShape.z;
            float mask = clamp(-dist / ${EDGE_FEATHER.toFixed(4)}, 0.0, 1.0);

            // 两段线性插值，对应 CSS 那三个色标：核心 → 中间 → 完全透明。
            float d = length(p - uGlareCenter);
            float inner = mix(uGlareStops.x, uGlareStops.y, clamp(d / uGlareStops.z, 0.0, 1.0));
            float fade = clamp((d - uGlareStops.z) / (uGlareStops.w - uGlareStops.z), 0.0, 1.0);
            float alpha = mix(inner, 0.0, fade) * mask;

            // Pixi 全程用预乘 alpha，白色预乘之后四个通道都等于 alpha。
            outColor = vec4(alpha);
    `,
  },
}

/**
 * 着色器程序全场只编译一次：每张卡各建一个 Shader（各自一份 uniform），但共用同一个程序，
 * 否则十几张牌就是十几次着色器编译，6.9 的「预热后编译次数为 0」当场就破。
 */
let program: GlProgram | null = null

function glareProgram(): GlProgram {
  program ??= compileHighShaderGlProgram({
    name: 'card-glare',
    // 这三块是 Pixi 自己给 Mesh 用的标配：局部变换和颜色、像素对齐。缺了 Mesh 画不出来。
    bits: [localUniformBitGl, glareBit, roundPixelsBitGl],
  })
  return program
}

/**
 * 一张卡的反光层。
 *
 * 几何由 CardSprite 传进来，而且就是卡面原画那一份——同一个四边形、同一套投影，
 * 所以它天然跟着卡一起倾斜和翻面，自己一行都不用算（见 components/cardGeometry.ts）。
 */
export class CardGlare extends Mesh<PerspectivePlaneGeometry, Shader> {
  /** 光心的 uniform 值，逐帧改的只有它，所以留一个引用免得每帧去查表。 */
  private readonly center: Float32Array

  constructor(geometry: PerspectivePlaneGeometry) {
    const center = new Float32Array([0, 0])
    super({
      geometry,
      shader: new Shader({
        glProgram: glareProgram(),
        resources: {
          glareUniforms: {
            uGlareCenter: { value: center, type: 'vec2<f32>' },
            uGlareStops: {
              value: new Float32Array([ALPHA_CORE, ALPHA_MID, STOP_MID, STOP_END]),
              type: 'vec4<f32>',
            },
            uGlareShape: {
              value: new Float32Array([0.5, 0.5 * ASPECT, CARD_RADIUS / CARD_WIDTH]),
              type: 'vec3<f32>',
            },
          },
        },
      }),
    })
    this.center = center
    this.label = 'card-glare'
    this.blendMode = 'screen'
    this.alpha = 0
    /*
     * 不亮的时候整个藏起来，不能只把 alpha 归零。
     * Pixi 判要不要画看的是 visible 不是 alpha；而它带自己的着色器，一进绘制队列
     * 就是一次单独的绘制调用加前后各一次状态切换（3.9），低档位干脆一次都不该出现。
     */
    this.visible = false
    // 命中判定归卡自己的 hitArea 管，反光只是画面。
    this.eventMode = 'none'
  }

  /**
   * 光心：传的是**指针在卡面上的相对位置**（0~1），这里自己取镜像点。
   *
   * 镜像是物理模型的一半：指针把卡按下去，翘向观察者、正对光源的是对角那一块，
   * 最亮的自然在那儿（另一半是倾斜的方向，见 components/cardTilt.ts）。
   */
  setPointer(ratioX: number, ratioY: number): void {
    this.center[0] = 0.5 - ratioX
    this.center[1] = (0.5 - ratioY) * ASPECT
    this.shader?.resources.glareUniforms.update()
  }
}
