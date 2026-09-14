/**
 * 底板类零件：需求单的面板 A（纸面页底）、B（侧栏底板）、D（夜色卡池底板）、
 * M（技能说明卡背）。
 *
 * 原来还有 C（对局顶栏）、E（Token 细条）、F（下一题纸匾）、G（对方回合吊匾）四档，
 * 正式版简化第 4 步之二把对局页剥成素方块之后没人用了，连同它们的预烤花纹一起删掉。
 *
 * 面板只画**底**，不装内容。旧版也是这么分的：底板换个尺寸就能给别处用。
 *
 * 底板走 Graphics 而不是预烤纹理，和卡牌那边的做法**相反**，理由是数量：
 * 卡牌一屏十几张，各画一份边框就是十几次单独绘制（见 fx/bakedTextures.ts 的文件头）；
 * 底板一屏最多三五块，而且尺寸各不相同、圆角还只圆某几个角，烤成纹理反而要为每种尺寸
 * 各烤一张。几何只在改尺寸时重画一次，不在动画期间重画，所以 3.10 那条不受影响。
 *
 * 旧版底板上那层纸纹是 CSS 的 `--battle-grain` data-URI 加 multiply 混合，这里没有：
 * 那属于素材不属于令牌（见 design 的 README），等第 33 条把美术资源搬过来再铺。
 * 阴影同理不画——3.1 不许挂 Filter，投影只能靠一张烤好的软边纹理，留到用得着的时候再说。
 */

import { tokens } from '@ai-duel/design'
import { Container, FillGradient, Graphics } from 'pixi.js'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'

/** 纸面页底那圈暗角的颜色，拆成通道好和透明度合成。'#7a6a4a' 就是这三个数。 */
const VIGNETTE_RGB = { r: 0x7a, g: 0x6a, b: 0x4a }

/** 编号变体。语义名见下面的别名常量。 */
export type PanelVariant = 'A' | 'B' | 'D' | 'M'

export const PANEL_PAGE: PanelVariant = 'A'
export const PANEL_SIDEBAR: PanelVariant = 'B'
export const PANEL_CARD_POOL: PanelVariant = 'D'
export const PANEL_SKILL_BACK: PanelVariant = 'M'

/** 每个变体的固有尺寸。A / B / D 由版式定宽高，所以是 null，建的时候必须给。 */
const INTRINSIC: Record<PanelVariant, { width: number; height: number } | null> = {
  A: null,
  B: null,
  D: null,
  M: { width: CARD_WIDTH, height: CARD_HEIGHT },
}

/** 现在这四档一张预烤纹理都不用了，依赖因此是空的。留着这个类型是为了调用方不用改签名。 */
export type PanelDeps = Record<string, never>

export interface PanelOptions {
  variant: PanelVariant
  /** A / B / D 必须给；M 给了也会被忽略——它的尺寸是固定的。 */
  width?: number
  height?: number
  /**
   * 侧栏底板（B）走哪一档配色。只有这一个变体有两档，别的变体忽略它。
   *
   * `battle` 是对局那一档：一整块纸，右缘一条竖描边（它左边就是屏幕边缘，不用围起来）。
   * `deck` 是构筑页那一档：纸色暗一档、四周一整圈框、圆角 4——那块面板浮在纸面页底上，
   * 不围起来就和背景糊成一片。
   *
   * 加参数而不是另开一个变体：需求单把两处记成同一个编号（面板 B），
   * 而它们的构造确实是同一件事（一块底 + 描边），只有配色和圆几个角不同。
   */
  tone?: 'battle' | 'deck'
}

export class Panel extends Container {
  readonly variant: PanelVariant
  readonly boxWidth: number
  readonly boxHeight: number

  private readonly plate = new Graphics()
  private readonly tone: 'battle' | 'deck'

  constructor(options: PanelOptions) {
    super()
    this.variant = options.variant
    const intrinsic = INTRINSIC[options.variant]
    if (intrinsic === null && (options.width === undefined || options.height === undefined)) {
      throw new Error(`面板 ${options.variant} 的尺寸由版式定，必须传 width 和 height`)
    }
    this.tone = options.tone ?? 'battle'
    this.boxWidth = intrinsic?.width ?? options.width ?? 0
    this.boxHeight = intrinsic?.height ?? options.height ?? 0

    // 底板是背景，不接指针事件——压在它上面的按钮才点得着。
    this.eventMode = 'none'
    this.addChild(this.plate)
    this.draw()
  }

  private draw(): void {
    switch (this.variant) {
      case 'A':
        this.drawPage()
        break
      case 'B':
        this.drawSidebar()
        break
      case 'D':
        this.drawCardPool()
        break
      case 'M':
        this.drawSkillBack()
        break
    }
  }

  /**
   * 纸面页底：整页那张纸，四周一圈往里收的暗角。
   *
   * 暗角走一次径向渐变填充，不是叠几层半透明矩形——叠出来会有一圈一圈的色带。
   * 它自带一张渐变纹理，所以这一块**打断一次合批**（3.9）；整页只有一块底，值这一次。
   * 旧版底上还压着两层纸纹（`.grain` 那两个伪元素），那是素材不是令牌，第 33 条再铺。
   */
  private drawPage(): void {
    const { boxWidth: w, boxHeight: h } = this
    this.plate.rect(0, 0, w, h).fill({ color: tokens.color.paper.base })
    /*
     * 渐变的坐标写在**局部空间**（0~1），所以换尺寸只要重画一遍矩形，不用重算圆心和半径。
     * 内圈到 45% 处全透明、外圈到边缘吃满，抄旧样式那条
     * `radial-gradient(130% 100% at 50% 42%, transparent 45%, ... 100%)`。
     */
    this.plate.rect(0, 0, w, h).fill(
      new FillGradient({
        type: 'radial',
        center: { x: 0.5, y: 0.42 },
        outerCenter: { x: 0.5, y: 0.42 },
        innerRadius: 0.45,
        outerRadius: 1,
        textureSpace: 'local',
        colorStops: [
          { offset: 0, color: { ...VIGNETTE_RGB, a: 0 } },
          { offset: 1, color: { ...VIGNETTE_RGB, a: tokens.opacity.deck.pageVignette } },
        ],
      }),
    )
  }

  /**
   * 侧栏底板：一块纸加描边。两档配色见 `PanelOptions.tone`。
   *
   * 对局档只描右缘那一条竖线——它左边就是屏幕边缘；构筑档四周一整圈、圆角 4，
   * 因为那块面板浮在纸面页底上，不围起来就和背景糊成一片。
   */
  private drawSidebar(): void {
    if (this.tone === 'deck') {
      this.plate
        .roundRect(0, 0, this.boxWidth, this.boxHeight, tokens.radius.sm)
        .fill({ color: tokens.color.paper.shade })
        .stroke({ width: 1, color: tokens.color.paper.lineDark })
      return
    }
    this.plate.rect(0, 0, this.boxWidth, this.boxHeight).fill({ color: tokens.color.battle.paper })
    this.plate
      .rect(this.boxWidth - 1, 0, 1, this.boxHeight)
      .fill({ color: tokens.color.battle.lineDark })
  }

  /**
   * 夜色卡池底板：一块深蓝底，一圈描边，内缘一道极淡的高光。
   *
   * 旧版底上铺的是战场背景图（`/battle/battle-bg.webp`），这里只画纯色那一层——
   * 图属于素材，第 33 条才搬进来（同 design 的 README「明确不收什么」）。
   * 内缘那道高光是一圈 1px 的白线压到 6% 透明度，抄 `inset 0 0 0 1px rgb(255 255 255 / 6%)`。
   */
  private drawCardPool(): void {
    const radius = tokens.radius.sm
    this.plate
      .roundRect(0, 0, this.boxWidth, this.boxHeight, radius)
      .fill({ color: tokens.color.deck.poolBase })
      .stroke({ width: 1, color: tokens.color.deck.poolLine })
    this.plate
      .roundRect(1, 1, this.boxWidth - 2, this.boxHeight - 2, Math.max(0, radius - 1))
      .stroke({
        width: 1,
        color: tokens.color.deck.poolInset,
        alpha: tokens.opacity.deck.poolInset,
      })
  }

  /**
   * 技能说明卡背：铺满一张卡的米色纸面，里面一圈细线。
   *
   * 内容（眉标、卡名、菱形分隔、效果正文）不在这里，同别的变体。
   */
  private drawSkillBack(): void {
    this.plate
      .roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS)
      .fill({ color: tokens.color.paper.base })
      .stroke({ width: 1, color: tokens.color.paper.lineDark })
    this.plate
      .roundRect(6, 6, CARD_WIDTH - 12, CARD_HEIGHT - 12, CARD_RADIUS - 6)
      .stroke({ width: 1, color: tokens.color.paper.line })
  }
}
