/**
 * 一张卡牌：卡下一团投影 + 图集里的原画 + 边框羽化带 + 卡面下部的铭牌 + 左上费用圆章，
 * 背面是牌背图，再加一层跟着指针跑的反光。
 *
 * 卡面**由哪几层组成**在 cardFaceParts.ts（三档铭牌、费用章、问号章的排版都在那儿），
 * 这个文件只管「怎么把一层画成会近大远小的四边形网格」。
 *
 * 坐标约定：容器的原点在**卡的底边中点**，也就是旋转和缩放的轴（和 fanMath 那套坐标一致）。
 * 卡面因此占 x ∈ [−75, 75]、y ∈ [−225, 0]。旧版 DOM 是靠 `transform-origin: 50% 100%`
 * 做到同一件事的，Pixi 这边直接把子节点摆到负 y 上，省掉一层 pivot。
 *
 * 每一层都是四边形网格而不是精灵：倾斜和翻面要真透视（近大远小），仿射变换做不出梯形。
 * 各层按自己的局部矩形过同一个投影（见 cardProjection.ts），算出四个角写进网格的几何。
 * 矩形一样的几层（原画、边框、反光都是整张卡）合成一组，一组只算一次、共用一份几何。
 * 细分只有 5×2 = 10 个顶点，远在 Pixi「顶点数不超过 100 才进合批」的门槛以内，
 * 换成网格之后仍然和别的卡合成同一批（3.9，实测合批打断次数和用精灵时一模一样）。
 *
 * 谁写什么，各管各的、谁也不覆盖谁：
 *   this      扇形布局和拖拽跟随写 position / rotation / scale / alpha
 *   投影      倾斜（cardTilt.ts）和翻面（场景的 flip）各写一个角度，合成一次投影
 *
 * 卡面上那几段文字在构造时就烤成纹理，之后场景里挂的是网格。
 * 所以这张卡建好之后**没有任何能改文字内容的对象**，3.5 那条不靠自觉靠结构。
 */

import {
  Container,
  Mesh,
  type PerspectivePlaneGeometry,
  Rectangle,
  type Shader,
  type Texture,
} from 'pixi.js'
import type { BakedTextures } from '../fx/bakedTextures'
import { CardGlare } from '../fx/cardGlare'
import { CARD_SHADOW } from '../fx/cardShapes'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { TextTextureCache } from '../runtime/textCache'
import {
  backLayerOf,
  cardRect,
  type FaceContent,
  type FaceLayer,
  frontLayersOf,
  shadowRect,
} from './cardFaceParts'
import {
  type LayerRect,
  type MeshVertices,
  newLayerGeometry,
  sharedFlatGeometry,
} from './cardGeometry'
import { CardProjector, type Corners, createCorners } from './cardProjection'

/**
 * 整张卡那么大的层用的网格细分。
 *
 * 透视校正是在顶点之间做分段线性近似的，顶点越多越准，但每个顶点都要参与合批时的逐帧打包，
 * 十几张牌乘起来在软件渲染的跑批机上很快就吃掉一大截帧时间，所以能少则少。
 *
 * 只加横向、纵向就两排，是因为翻面（绕 Y 轴）造成的透视只沿横向变化：卡面在 z = 0 上，
 * 绕 Y 转之后每一点的深度只跟它的 x 有关，纵向那一维是严格线性的，细分了也白细分。
 * 倾斜（绕 X）确实会让纵向也非线性，但它最大只有 10°，那点弯曲不到一个像素。
 */
const CARD_MESH_VERTICES: MeshVertices = { x: 5, y: 2 }
/** 费用章、文字这些小件用的细分。它们只有几十像素见方，四个角就够，多了纯属浪费。 */
const SMALL_MESH_VERTICES: MeshVertices = { x: 2, y: 2 }

/**
 * 建一张卡要的数据：正面那一套（`FaceContent`，见 cardFaceParts.ts）加上这是谁、背面是什么。
 * 纹理由调用方给——canvas 不管资源从哪来。
 */
export interface CardVisual extends FaceContent {
  /**
   * 这张牌的**实例**标识，扇形和战场都按它认牌。
   *
   * 不是卡牌定义 id：同一张牌可以同时存在好几个实例（手上两张一样的、场上一张手里一张），
   * 按定义 id 认牌的话它们会互相顶掉。想知道「这是哪张牌面」要去问视图或者调用方自己那份账
   *（对局场景记在 `DuelContext.handCardIds` 里）。
   */
  instanceId: string
  /** 背面牌背。 */
  back: Texture
}

export interface CardSpriteDeps {
  baked: BakedTextures
  text: TextTextureCache
  /**
   * 这一档要不要卡面反光（见 fx/effectTier.ts 的 TierConfig.glare）。
   * 不要就连建都不建：反光层带一份自己的着色器，低档位建出来也永远不会亮。
   */
  glare: boolean
  /**
   * 这一档要不要卡下的投影（见 fx/effectTier.ts 的 TierConfig.cardShadow）。
   *
   * 低档关掉不是为了省一次绘制，是为了填充率（3.2）：投影是一整张比卡还大的半透明贴图，
   * 屏幕上十几张牌就等于多铺十几层，而低档那批机器最先耗尽的正是填充率。
   */
  shadow: boolean
}

/**
 * 共用一份几何的一组层：矩形一样、投影结果就一样，没必要各算一遍。
 * 卡面原画、边框、反光都是整张卡那么大，所以它们是同一组。
 */
interface LayerGroup extends LayerRect {
  /** 这一组共用的几何。刚建卡时是全场共用的平放那份，见 takeOwnGeometry。 */
  geometry: PerspectivePlaneGeometry
  meshes: Mesh<PerspectivePlaneGeometry, Shader>[]
  vertices: MeshVertices
  /** 牌背要左右对调才不是镜像的，理由见 cardProjection 的 project。 */
  mirrored: boolean
}

export class CardSprite extends Container {
  /** 这张卡的实例标识，含义同 `CardVisual.instanceId`。 */
  readonly instanceId: string
  /** 卡面那一小块反光，平时藏着（visible 为 false）。这一档不开反光时是 null。 */
  readonly glare: CardGlare | null
  /**
   * 这张牌能不能翻面看背面（右上角挂着那枚问号章）。
   *
   * 翻不翻由调用方在 `CardVisual.flippable` 上说了算，这里只是把它记下来给指针那边看
   *（点章翻面的判定在 interaction/handPointer.ts）。
   */
  readonly flippable: boolean

  private readonly frontLayer = new Container()
  private readonly backLayer = new Container()
  private readonly frontGroups: LayerGroup[] = []
  private readonly backGroups: LayerGroup[] = []
  /**
   * 卡下那团投影。它两面都在，所以不进上面那两个列表——
   * 投影那一组要跟着每一帧的姿态走，不管此刻朝上的是正面还是背面。
   */
  private shadowGroup: LayerGroup | null = null
  /** 投影那一层的网格，`setLifted` 开关它。这一档不画投影时是 null。 */
  private shadowMesh: Mesh<PerspectivePlaneGeometry, Shader> | null = null
  /** 建过的每一组，销毁和换几何时按它遍历（投影那一组也在里面，不会被漏掉或数两遍）。 */
  private readonly allGroups: LayerGroup[] = []
  private readonly projector = new CardProjector()
  /** 投影结果的落脚点。复用同一个数组，逐帧投影不产生堆分配（3.10）。 */
  private readonly corners: Corners = createCorners()
  /** 各层还在用全场共用的那份平放几何。第一次真要投影时才换成自己的，见 takeOwnGeometry。 */
  private ownsGeometry = false

  /** 跟着指针的倾斜角（度），由 cardTilt 每帧写。 */
  private tiltX = 0
  private tiltY = 0
  /** 翻面转过的角度（度），0 是正面、180 是背面。 */
  private flipAngle = 0

  /**
   * 翻面用的角度代理。补间改它，onUpdate 再调 setFlipAngle。
   *
   * 它是**卡旁边挂的一个独立对象**，不是卡上的属性，而 GSAP 按目标对象认补间——
   * 掐卡（或它的后代）掐不到这条补间。所以销毁卡时必须单独把它上面的补间也掐掉，
   * 这件事由 `runtime/dispose.ts` 的 `killAndDestroy` 统一负责，别处不用自己操心。
   */
  readonly flipState = { angle: 0 }

  /**
   * 每一层原本该是什么颜色。压暗（`setDim`）时拿它当底，压暗解除后照它还原。
   *
   * 非记不可：卡上有两层本来就带自己的颜色（费用章的盘底按牌上色、匾上的字按主色），
   * 直接往 `mesh.tint` 上写压暗色会把那两层的原色抹掉，还原时也没处找回来。
   */
  private readonly baseTints: number[] = []
  /** 现在整张卡压到哪一档（0xffffff 是本色）。 */
  private dimTint = 0xffffff

  constructor(visual: CardVisual, deps: CardSpriteDeps) {
    super()
    this.instanceId = visual.instanceId
    this.flippable = visual.flippable === true
    this.label = `card:${visual.instanceId}`

    this.backLayer.visible = false
    if (deps.shadow) this.buildShadow(deps)
    this.addChild(this.frontLayer, this.backLayer)

    /*
     * 反光和卡面原画是同一个四边形，所以它直接借用那一组的几何，自己不再建一份。
     * 借的是"平放"那份共用几何，之后跟着整组一起换成卡自己的（takeOwnGeometry）。
     */
    this.glare = deps.glare
      ? new CardGlare(sharedFlatGeometry(cardRect(), CARD_MESH_VERTICES, false))
      : null

    const front = frontLayersOf(visual, deps)
    for (const layer of front) this.addLayer(this.frontLayer, this.frontGroups, layer, false)
    // 反光排在整张卡那一组的最后，画在原画和边框之上。
    if (this.glare !== null) {
      this.frontLayer.addChild(this.glare)
      this.frontGroups[0]?.meshes.push(this.glare)
    }
    this.addLayer(this.backLayer, this.backGroups, backLayerOf(visual.back), true)
    // 记下各层的本色，压暗时要拿它当底（见 setDim）。反光那一层也在里面，顺序和遍历时一致。
    for (const group of [...this.frontGroups, ...this.backGroups]) {
      for (const mesh of group.meshes) this.baseTints.push(Number(mesh.tint))
    }

    this.eventMode = 'static'
    this.cursor = 'pointer'
    /*
     * 命中区显式给成卡面那个矩形，不让 Pixi 按子节点的包围盒算。
     * 三个原因：一是每帧重算包围盒本身就是白花的开销；二是倾斜和翻面期间各层是梯形，
     * 包围盒每帧都在变，命中区会跟着抖——而扇形 hover 防抖动那套要求命中区必须稳定盖住原位；
     * 三是投影那一层比卡大出一圈，按包围盒算的话卡外那圈透明的阴影也会吃指针。
     * 这个矩形在卡自己的坐标里，所以 hover 放大、拖拽放大都会自动跟着一起放大。
     */
    this.hitArea = new Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT)
  }

  /**
   * 跟着指针的倾斜角（度）。绕 X 正数让上沿往后倒、绕 Y 正数让右沿往后倒。
   * 角度没变就什么都不做：逐帧调用里绝大多数帧是稳态，重算一遍角点纯属浪费。
   */
  setTilt(rotXDeg: number, rotYDeg: number): void {
    if (rotXDeg === this.tiltX && rotYDeg === this.tiltY) return
    this.tiltX = rotXDeg
    this.tiltY = rotYDeg
    this.refreshProjection()
  }

  /**
   * 按角度摆好翻面姿态：0° 是正面，180° 是背面。
   *
   * 翻面就是绕 Y 轴转，和倾斜的绕 Y 是同一个自由度，所以两者相加后过同一个投影
   * ——转到 90° 时卡正好侧对观察者、投影宽度为零，转过头之后近的那一侧还会更大，
   * 这是旧版「压扁到 cos θ」那种二维模拟给不出来的。
   * 正反面在跨过 90° 那一刻硬切：那时卡宽是 0，切换看不见（旧版 DOM 那边也是这么切的，
   * 理由见黑客松版的 flipCard.ts——backface-visibility 在补间途中判断不可靠）。
   */
  setFlipAngle(angleDeg: number): void {
    if (angleDeg === this.flipAngle) return
    this.flipAngle = angleDeg
    this.refreshProjection()
  }

  /** 现在朝上的是不是背面。 */
  isFacingBack(): boolean {
    return this.backLayer.visible
  }

  /**
   * 这张牌现在是不是"浮起来"的：抬起来看、被拖着、或者摆在展示层中央。浮起来才画投影。
   *
   * 为什么不给每张牌都常画（黑客松那边 `.card-face` 是无条件带 `box-shadow` 的）：
   * 投影是一整张**比卡还大**的半透明贴图，一屏十几二十张牌就等于多铺十几层，
   * 而过度绘制（3.2）按包围盒算，实测把桌面档「一轮结算」那一屏从 2.91 顶到 3.06、
   * 直接超上限。摊平在战场上的小卡本来也没有"浮起来"的语义，真需要影子的就是这三种时候。
   */
  setLifted(lifted: boolean): void {
    if (this.shadowMesh !== null) this.shadowMesh.visible = lifted
  }

  /**
   * 整张卡压暗到某一档：`tint` 乘在每一层原本的颜色上，0xffffff 就是本色。
   *
   * 黑客松那边是 CSS 滤镜（灰墨态 `saturate(.5) brightness(.9)`、打不出
   * `grayscale(.6) brightness(.72)`），而纪律 3.1 不许挂 Filter，所以只能用 tint 近似：
   * tint 是逐通道相乘，压得暗但去不了饱和度，颜色上会比旧版艳一点，
   * 「这排牌现在动不了」这件事仍然一眼看得出来。
   *
   * 卡下那团投影不跟着压：它本来就是黑的，再乘一个灰没有任何区别。
   */
  setDim(tint: number): void {
    if (tint === this.dimTint) return
    this.dimTint = tint
    let index = 0
    for (const group of [...this.frontGroups, ...this.backGroups]) {
      for (const mesh of group.meshes) {
        const base = this.baseTints[index] ?? 0xffffff
        index += 1
        mesh.tint = tint === 0xffffff ? base : multiplyTint(base, tint)
      }
    }
  }

  /**
   * 把当前的倾斜和翻面角度算成各组的四个角。
   *
   * 两处偷懒都是有意的：
   * 一是角度全为 0 而且还在用共用几何时直接返回——共用的那份本来就是平放的姿态，
   *   而且它是全场共用的，往里写就是把别的卡一起改了；
   * 二是只算露在外面那一面，另一面这一帧看不见（可见性就在这里定，先定再算）。
   */
  private refreshProjection(): void {
    const angle = ((this.flipAngle % 360) + 360) % 360
    const showBack = angle > 90 && angle < 270
    this.frontLayer.visible = !showBack
    this.backLayer.visible = showBack

    const flat = this.tiltX === 0 && this.tiltY === 0 && this.flipAngle === 0
    if (flat && !this.ownsGeometry) return
    if (!this.ownsGeometry) this.takeOwnGeometry()

    this.projector.setAngles(this.tiltX, this.tiltY + this.flipAngle)
    const shadow = this.shadowGroup
    if (shadow !== null) this.project(shadow)
    for (const group of showBack ? this.backGroups : this.frontGroups) this.project(group)
  }

  private project(group: LayerGroup): void {
    this.projector.project(
      group.x,
      group.y,
      group.width,
      group.height,
      this.corners,
      group.mirrored,
    )
    group.geometry.setCorners(...this.corners)
  }

  /**
   * 把各层从共用的平放几何换成这张卡自己的一份。
   * 只有真的要投影（被指针倾斜、或者开始翻面）的那一两张卡会走到这里，见 cardGeometry.ts。
   */
  private takeOwnGeometry(): void {
    this.ownsGeometry = true
    for (const group of this.allGroups) {
      const geometry = newLayerGeometry(group, group.vertices, group.mirrored)
      group.geometry = geometry
      for (const mesh of group.meshes) mesh.geometry = geometry
    }
  }

  /**
   * 卡下那团投影：一张比卡大出一圈、整体往下挪一点的软阴影贴图。
   *
   * 摆在 frontLayer / backLayer 之前，所以它永远压在卡底下；单独一组几何，
   * 因为它的矩形和卡面不一样大。
   */
  private buildShadow(deps: CardSpriteDeps): void {
    this.shadowGroup = this.addLayer(
      this,
      [],
      { rect: shadowRect(CARD_SHADOW), mesh: 'small', parts: [{ texture: deps.baked.cardShadow }] },
      false,
    )
    this.shadowMesh = this.shadowGroup.meshes[0] ?? null
    // 平时不画，只有"浮起来"的那张才亮（理由见 setLifted）。
    if (this.shadowMesh !== null) this.shadowMesh.visible = false
  }

  /**
   * 加一层：同一块矩形上叠的几张贴图共用一份几何。
   * 一开始用的是全场共用的平放几何，所以建卡这一步一个几何都不新建。
   * 细分记在组上：换成自己那份时必须用同一个细分，理由见 cardGeometry.ts 的 shared。
   */
  private addLayer(
    parent: Container,
    groups: LayerGroup[],
    layer: FaceLayer,
    mirrored: boolean,
  ): LayerGroup {
    const vertices = layer.mesh === 'card' ? CARD_MESH_VERTICES : SMALL_MESH_VERTICES
    const geometry = sharedFlatGeometry(layer.rect, vertices, mirrored)
    const meshes = layer.parts.map((part) => {
      const mesh = new Mesh<PerspectivePlaneGeometry, Shader>({
        geometry,
        texture: part.texture,
      })
      // tint 和 alpha 都不触发重建，符合 3.10。
      if (part.tint !== undefined) mesh.tint = part.tint
      if (part.alpha !== undefined) mesh.alpha = part.alpha
      parent.addChild(mesh)
      return mesh
    })
    const group: LayerGroup = { geometry, meshes, ...layer.rect, vertices, mirrored }
    groups.push(group)
    this.allGroups.push(group)
    return group
  }

  /**
   * 拆卡。
   *
   * 自己那份几何和反光的着色器都要手动收：Pixi 的 `Mesh.destroy` 只把引用置空，
   * 不动它们（几何和着色器本来就允许多个 Mesh 共用，它没法替调用方决定）。
   * 还在用共用几何的卡什么都不用收——那批本来就不归任何一张卡（见 cardGeometry.ts）。
   * 着色器程序也不销毁，那是全场共用的一份，见 fx/cardGlare.ts。
   */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.ownsGeometry) {
      for (const group of this.allGroups) group.geometry.destroy()
    }
    this.glare?.shader?.destroy()
    super.destroy(options)
  }
}

/** 两个 tint 逐通道相乘。tint 本来就是乘上去的，叠两层就是再乘一次。 */
function multiplyTint(base: number, dim: number): number {
  const channel = (shift: number): number =>
    Math.round((((base >> shift) & 0xff) * ((dim >> shift) & 0xff)) / 255)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}
