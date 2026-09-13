/**
 * 选英雄页那张人物卡：**一整幅原画** + 卡下一团烤出来的投影 + 一层跟指针跑的反光。
 *
 * 不用 `CardSprite`：那一套会往卡面上再叠铭牌和费用圆章，而人物卡的名字、边框、装饰
 * 本来就画在图里，英雄也没有费用（同 duelContract 里 `CardTextures.heroes` 那条说明）。
 *
 * 但**坐标系和 `CardSprite` 完全一致**：原点在卡的底边中点，卡面占 x ∈ [−75, 75]、
 * y ∈ [−225, 0]（也就是基准尺寸 150×225），多大由外层容器的 scale 定。这样三样东西
 * 一行都不用改就能直接复用：
 *
 * - `cardProjection.ts` 的真透视（它的透视距离 1000 正好是卡宽的 6.67 倍，而黑客松给
 *   人物卡写的是 `perspective: 83cqi` 配 `12.5cqi` 的卡、详情大卡 `146cqi` 配 `22cqi`，
 *   两处都是 6.64 倍——同一个口径）；
 * - `fx/cardGlare.ts` 的反光着色器（它按卡宽归一算圆角和渐变，人物卡同样是 2:3）；
 * - `components/RevealOverlay` 的落点换算（它按「卡的原点在底边中点」算 y）。
 *
 * 圆角不在这里做：它在构建期就烤进原画的 alpha 了（见 assets/build-atlas.mjs 的
 * `roundHero`，半径按卡宽的 8/150 取，和卡面图集同一条规矩）。运行期不挂遮罩也不挂
 * Filter（纪律 3.1）。
 *
 * 几何**每张卡各建一份**，不走 `sharedFlatGeometry` 那条共用路：一页上只有七张卡加详情
 * 那一张，而它们全都会被指针倾斜（共用那份是给一局里几十张平放的手牌省内存的）。
 * 各建一份之后就没有「要不要换成自己那份」这道判断，建在摆版式的时候，一帧都不在动画期间。
 */

import {
  Container,
  Mesh,
  type PerspectivePlaneGeometry,
  Rectangle,
  type Renderer,
  type Shader,
  type Texture,
} from 'pixi.js'
import { cardRect, shadowRect } from '../../components/cardFaceParts'
import { type MeshVertices, newLayerGeometry } from '../../components/cardGeometry'
import { CardProjector, type Corners, createCorners } from '../../components/cardProjection'
import { CardGlare } from '../../fx/cardGlare'
import { drawCardShadow } from '../../fx/cardShapes'

/**
 * 人物卡下那团投影，换算到基准尺寸（150 宽）下的像素。
 *
 * 黑客松 `.hero__card-tilt` 写的是 `box-shadow: 0 .45cqi 1.1cqi rgb(4 8 14 / 40%)`，
 * 那是一张 12.5cqi 宽的卡，所以按卡宽折算：偏移 0.45/12.5 × 150 = 5.4、
 * 模糊 1.1/12.5 × 150 = 13.2。
 *
 * 详情那张大卡的投影在那一版里更重（`0 1.2cqi 2.6cqi rgb(4 8 14 / 60%)`），这里**共用同一张
 * 贴图**：贴图的矩形跟着卡一起放大，2.45 倍下模糊已经有三十多个屏幕像素，和那一档差的只是
 * 透明度。为此多烤一张纹理不值当——它是整张卡那么大的一层，而这一页的过度绘制（3.2）本来就紧。
 *
 * 颜色仍然是纯黑：贴图是黑的，往黑的上面 tint 一个近黑色（rgb(4 8 14)）乘出来还是黑的，
 * 四成透明度下那点色差看不出来。
 */
const HERO_SHADOW = { blur: 13.2, offsetY: 5.4, alpha: 0.4 } as const

/** 整张卡那么大的层用的网格细分，和 `CardSprite` 取同一档（理由见那边的注释）。 */
const CARD_MESH: MeshVertices = { x: 5, y: 2 }
/** 投影那一层只是一块糊边的贴图，四个角就够。 */
const SHADOW_MESH: MeshVertices = { x: 2, y: 2 }

/** 这一页自己烤的那一张纹理。建场景时烤一次，动画期间一次都不烤（6.9）。 */
export interface HeroTextures {
  shadow: Texture
  destroy(): void
}

/**
 * 烤出人物卡要的那张投影贴图。
 *
 * 不塞进 `fx/bakedTextures.ts`：那一批是**对局和组牌页**的卡牌共用的，里面那张
 * `cardShadow` 是另一档数（模糊 24、四成半）。把这一张也加进去等于让每个场景都多烤一张
 * 只有选英雄页用得上的纹理。
 */
export function bakeHeroTextures(renderer: Renderer): HeroTextures {
  const shadow = drawCardShadow(HERO_SHADOW)
  const texture = renderer.generateTexture({
    // 取景框写死，不让 Pixi 按包围盒算（理由见 fx/mold.ts）。
    target: shadow.graphics,
    frame: new Rectangle(0, 0, shadow.width, shadow.height),
    resolution: renderer.resolution,
    antialias: true,
  })
  return {
    shadow: texture,
    destroy() {
      texture.destroy(true)
      shadow.graphics.destroy()
    },
  }
}

export interface HeroCardArtDeps {
  /** 卡下那团投影的贴图。不给就不画投影。 */
  shadow: Texture | null
  /** 这一档要不要卡面反光。不要就连建都不建——它带一份自己的着色器。 */
  glare: boolean
}

/**
 * 一张人物卡。会动的只有「倾斜」这一件事，由 `components/cardTilt.ts` 逐帧写
 *（它收的就是 `setTilt` + `glare` 这两样）。位置、缩放、透明度归外层容器，谁也不抢。
 */
export class HeroCardArt extends Container {
  /** 卡面那一小块反光，平时藏着。这一档不开反光时是 null。 */
  readonly glare: CardGlare | null

  private readonly artGeometry: PerspectivePlaneGeometry
  private readonly shadowGeometry: PerspectivePlaneGeometry | null
  private readonly art = cardRect()
  private readonly shade = shadowRect(HERO_SHADOW)
  private readonly projector = new CardProjector()
  /** 投影结果的落脚点。复用同一个数组，逐帧投影不产生堆分配（3.10）。 */
  private readonly corners: Corners = createCorners()
  private tiltX = 0
  private tiltY = 0

  constructor(texture: Texture, deps: HeroCardArtDeps) {
    super()
    this.label = 'hero-card'
    // 命中判定归卡阵那一层的矩形管（见 heroGrid.ts），这里整棵树都不吃指针事件。
    this.eventMode = 'none'

    this.shadowGeometry =
      deps.shadow === null ? null : newLayerGeometry(this.shade, SHADOW_MESH, false)
    if (this.shadowGeometry !== null && deps.shadow !== null) {
      const mesh = new Mesh<PerspectivePlaneGeometry, Shader>({
        geometry: this.shadowGeometry,
        texture: deps.shadow,
      })
      this.addChild(mesh)
    }

    this.artGeometry = newLayerGeometry(this.art, CARD_MESH, false)
    this.addChild(
      new Mesh<PerspectivePlaneGeometry, Shader>({ geometry: this.artGeometry, texture }),
    )

    // 反光和原画是同一个四边形，直接借它那份几何，于是天然跟着一起倾斜。
    this.glare = deps.glare ? new CardGlare(this.artGeometry) : null
    if (this.glare !== null) this.addChild(this.glare)
  }

  /**
   * 跟着指针的倾斜角（度）。绕 X 正数让上沿往后倒、绕 Y 正数让右沿往后倒。
   * 角度没变就什么都不做：逐帧调用里绝大多数帧是稳态，重算一遍角点纯属浪费。
   */
  setTilt(rotXDeg: number, rotYDeg: number): void {
    if (rotXDeg === this.tiltX && rotYDeg === this.tiltY) return
    this.tiltX = rotXDeg
    this.tiltY = rotYDeg
    this.projector.setAngles(rotXDeg, rotYDeg)
    this.project(this.art, this.artGeometry)
    if (this.shadowGeometry !== null) this.project(this.shade, this.shadowGeometry)
  }

  private project(
    rect: { x: number; y: number; width: number; height: number },
    geometry: PerspectivePlaneGeometry,
  ): void {
    this.projector.project(rect.x, rect.y, rect.width, rect.height, this.corners)
    geometry.setCorners(...this.corners)
  }

  /**
   * 拆卡。几何和反光的着色器都要手动收：Pixi 的 `Mesh.destroy` 只把引用置空，不动它们
   *（几何和着色器本来就允许多个 Mesh 共用，它没法替调用方决定）。着色器**程序**不收，
   * 那是全场共用的一份（见 fx/cardGlare.ts）。
   */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.artGeometry.destroy()
    this.shadowGeometry?.destroy()
    this.glare?.shader?.destroy()
    super.destroy(options)
  }
}
