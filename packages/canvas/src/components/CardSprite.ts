/**
 * 一张卡牌：图集里的原画 + 底部铭牌（模型名）+ 左上费用圆章，背面是牌背图，
 * 再加一层跟着指针跑的反光。
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
 * 卡面上的两段文字（模型名、费用数字）在构造时就烤成纹理，之后场景里挂的是网格。
 * 所以这张卡建好之后**没有任何能改文字内容的对象**，3.5 那条不靠自觉靠结构。
 */

import { tokens } from '@ai-duel/design'
import {
  Container,
  Mesh,
  type PerspectivePlaneGeometry,
  Rectangle,
  type Shader,
  TextStyle,
  type Texture,
} from 'pixi.js'
import { COST_BADGE_CENTER, COST_BADGE_SIZE, NAMEPLATE_HEIGHT } from '../fx/badgeShapes'
import type { BakedTextures } from '../fx/bakedTextures'
import { CardGlare } from '../fx/cardGlare'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { TextTextureCache } from '../runtime/textCache'
import {
  type LayerRect,
  type MeshVertices,
  newLayerGeometry,
  sharedFlatGeometry,
} from './cardGeometry'
import { CardProjector, type Corners, createCorners } from './cardProjection'

/** 铭牌上模型名的字号。卡面 150 宽，14px 下最长的那几个模型名刚好排得开。 */
const NAME_FONT_SIZE = 14
/**
 * 费用数字的字号。
 * 按圆章直径取的（COST_BADGE_SIZE ≈ 31.2）：0.52 倍直径下，两位数也排得进最里面那圈细线。
 */
const COST_FONT_SIZE = Math.round(COST_BADGE_SIZE * 0.52)

/**
 * 整张卡那么大的层用的网格细分。
 *
 * 透视校正是在顶点之间做分段线性近似的，顶点越多越准，但每个顶点都要参与合批时的逐帧打包，
 * 十几张牌乘起来在软件渲染的跑批机上很快就吃掉一大截帧时间，所以能少则少。
 *
 * 只加横向、纵向就两排，是因为翻面（绕 Y 轴）造成的透视只沿横向变化：卡面在 z = 0 上，
 * 绕 Y 转之后每一点的深度只跟它的 x 有关，纵向那一维是严格线性的，细分了也白细分。
 * 倾斜（绕 X）确实会让纵向也非线性，但它最大只有 6°，那点弯曲不到一个像素。
 */
const CARD_MESH_VERTICES: MeshVertices = { x: 5, y: 2 }
/** 费用章、文字这些小件用的细分。它们只有几十像素见方，四个角就够，多了纯属浪费。 */
const SMALL_MESH_VERTICES: MeshVertices = { x: 2, y: 2 }

/** 建一张卡要的数据。纹理由调用方给——canvas 不管资源从哪来。 */
export interface CardVisual {
  /**
   * 这张牌的**实例**标识，扇形和战场都按它认牌。
   *
   * 不是卡牌定义 id：同一张牌可以同时存在好几个实例（手上两张一样的、场上一张手里一张），
   * 按定义 id 认牌的话它们会互相顶掉。想知道「这是哪张牌面」要去问视图或者调用方自己那份账
   *（对局场景记在 `DuelContext.handCardIds` 里）。
   */
  instanceId: string
  /** 印在铭牌上的名字。 */
  name: string
  /** 左上圆章里的数字。 */
  cost: number
  /** 正面原画。 */
  face: Texture
  /** 背面牌背。 */
  back: Texture
  /** 费用圆章的盘底色，跟着原画主色走（旧版 AI_MODEL_FACE 的 accent）。 */
  accent: number
}

export interface CardSpriteDeps {
  baked: BakedTextures
  text: TextTextureCache
  /**
   * 这一档要不要卡面反光（见 fx/effectTier.ts 的 TierConfig.glare）。
   * 不要就连建都不建：反光层带一份自己的着色器，低档位建出来也永远不会亮。
   */
  glare: boolean
}

/**
 * 共用一份几何的一组层：矩形一样、投影结果就一样，没必要各算一遍。
 * 卡面原画、边框铭牌、反光都是整张卡那么大，所以它们是同一组。
 */
interface LayerGroup extends LayerRect {
  /** 这一组共用的几何。刚建卡时是全场共用的平放那份，见 takeOwnGeometry。 */
  geometry: PerspectivePlaneGeometry
  meshes: Mesh<PerspectivePlaneGeometry, Shader>[]
  vertices: MeshVertices
  /** 牌背要左右对调才不是镜像的，理由见 cardProjection 的 project。 */
  mirrored: boolean
}

/** 两个共享的文字样式，全场只建一次：TextStyle 一变就要重新量文字，没必要每张牌各建一份。 */
let nameStyle: TextStyle | null = null
let costStyle: TextStyle | null = null

function styles(): { name: TextStyle; cost: TextStyle } {
  nameStyle ??= new TextStyle({
    fontFamily: tokens.font.family.serif,
    fontSize: NAME_FONT_SIZE,
    fontWeight: '600',
    fill: tokens.color.battle.ink,
  })
  costStyle ??= new TextStyle({
    fontFamily: tokens.font.family.serif,
    fontSize: COST_FONT_SIZE,
    fontWeight: '700',
    fill: tokens.color.paper.base,
  })
  return { name: nameStyle, cost: costStyle }
}

export class CardSprite extends Container {
  /** 这张卡的实例标识，含义同 `CardVisual.instanceId`。 */
  readonly instanceId: string
  /** 卡面那一小块反光，平时藏着（visible 为 false）。这一档不开反光时是 null。 */
  readonly glare: CardGlare | null

  private readonly frontLayer = new Container()
  private readonly backLayer = new Container()
  private readonly frontGroups: LayerGroup[] = []
  private readonly backGroups: LayerGroup[] = []
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

  /** 翻面用的角度代理。补间改它，onUpdate 再调 setFlipAngle。 */
  readonly flipState = { angle: 0 }

  constructor(visual: CardVisual, deps: CardSpriteDeps) {
    super()
    this.instanceId = visual.instanceId
    this.label = `card:${visual.instanceId}`

    this.backLayer.visible = false
    this.addChild(this.frontLayer, this.backLayer)

    /*
     * 反光和卡面原画是同一个四边形，所以它直接借用那一组的几何，自己不再建一份。
     * 借的是"平放"那份共用几何，之后跟着整组一起换成卡自己的（takeOwnGeometry）。
     */
    this.glare = deps.glare
      ? new CardGlare(sharedFlatGeometry(cardRect(), CARD_MESH_VERTICES, false))
      : null
    this.buildFront(visual, deps)
    this.buildBack(visual)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    /*
     * 命中区显式给成卡面那个矩形，不让 Pixi 按子节点的包围盒算。
     * 两个原因：一是每帧重算包围盒本身就是白花的开销；二是倾斜和翻面期间各层是梯形，
     * 包围盒每帧都在变，命中区会跟着抖——而扇形 hover 防抖动那套要求命中区必须稳定盖住原位。
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
   * 理由见 legacy 的 flipCard.ts——backface-visibility 在补间途中判断不可靠）。
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
    for (const group of showBack ? this.backGroups : this.frontGroups) {
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
  }

  /**
   * 把各组从共用的平放几何换成这张卡自己的一份。
   * 只有真的要投影（被指针倾斜、或者开始翻面）的那一两张卡会走到这里，见 cardGeometry.ts。
   */
  private takeOwnGeometry(): void {
    this.ownsGeometry = true
    for (const group of [...this.frontGroups, ...this.backGroups]) {
      const geometry = newLayerGeometry(group, group.vertices, group.mirrored)
      group.geometry = geometry
      for (const mesh of group.meshes) mesh.geometry = geometry
    }
  }

  /**
   * 加一组层：几层共用一个矩形、一份几何。
   * 一开始用的是全场共用的平放几何，所以建卡这一步一个几何都不新建。
   * 细分记在组上：换成自己那份时必须用同一个细分，理由见 cardGeometry.ts 的 shared。
   */
  private addGroup(
    parent: Container,
    groups: LayerGroup[],
    textures: Texture[],
    rect: LayerRect,
    vertices: MeshVertices,
    mirrored = false,
  ): LayerGroup {
    const geometry = sharedFlatGeometry(rect, vertices, mirrored)
    const meshes = textures.map((texture) => {
      const mesh = new Mesh<PerspectivePlaneGeometry, Shader>({ geometry, texture })
      parent.addChild(mesh)
      return mesh
    })
    const group: LayerGroup = { geometry, meshes, ...rect, vertices, mirrored }
    groups.push(group)
    return group
  }

  private buildFront(visual: CardVisual, deps: CardSpriteDeps): void {
    // 原画、边框铭牌、反光都是整张卡那么大，共用一份几何。
    // 原画是 2:3，卡面 150×225 也是 2:3，所以直接铺满；四角的圆角已经烤进图集的 alpha 了。
    const face = this.addGroup(
      this.frontLayer,
      this.frontGroups,
      [visual.face, deps.baked.cardChrome],
      cardRect(),
      CARD_MESH_VERTICES,
    )
    // 反光排在这一组最后，画在原画和边框之上。
    if (this.glare !== null) {
      this.frontLayer.addChild(this.glare)
      face.meshes.push(this.glare)
    }

    const nameText = deps.text.get(`name|${visual.name}`, visual.name, styles().name)
    // 名字太长就整体压窄，不换行也不裁字：铭牌只有一行高，换行会顶出卡外。
    const maxNameWidth = CARD_WIDTH - 24
    const nameScale = Math.min(1, maxNameWidth / nameText.width)
    this.addGroup(
      this.frontLayer,
      this.frontGroups,
      [nameText],
      centered(
        0,
        -6 - NAMEPLATE_HEIGHT / 2,
        nameText.width * nameScale,
        nameText.height * nameScale,
      ),
      SMALL_MESH_VERTICES,
    )

    const badgeX = -CARD_WIDTH / 2 + COST_BADGE_CENTER.x
    const badgeY = -CARD_HEIGHT + COST_BADGE_CENTER.y
    const badge = this.addGroup(
      this.frontLayer,
      this.frontGroups,
      [deps.baked.costBadge],
      centered(badgeX, badgeY, COST_BADGE_SIZE, COST_BADGE_SIZE),
      SMALL_MESH_VERTICES,
    )
    // 盘底是白的，按各张牌的主色上色；tint 不触发重建，符合 3.10。
    badge.meshes[0]!.tint = visual.accent

    const costText = String(visual.cost)
    const cost = deps.text.get(`cost|${costText}`, costText, styles().cost)
    this.addGroup(
      this.frontLayer,
      this.frontGroups,
      [cost],
      centered(badgeX, badgeY, cost.width, cost.height),
      SMALL_MESH_VERTICES,
    )
  }

  private buildBack(visual: CardVisual): void {
    this.addGroup(
      this.backLayer,
      this.backGroups,
      [visual.back],
      cardRect(),
      CARD_MESH_VERTICES,
      true,
    )
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
      for (const group of [...this.frontGroups, ...this.backGroups]) group.geometry.destroy()
    }
    this.glare?.shader?.destroy()
    super.destroy(options)
  }
}

/** 整张卡那么大的矩形（原点在底边中点，所以卡面在负 y 上）。 */
function cardRect(): LayerRect {
  return { x: -CARD_WIDTH / 2, y: -CARD_HEIGHT, width: CARD_WIDTH, height: CARD_HEIGHT }
}

/** 以 (cx, cy) 为中心的矩形。卡上的小件都是按中心摆的，换算一次省得到处写减法。 */
function centered(cx: number, cy: number, width: number, height: number): LayerRect {
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}
