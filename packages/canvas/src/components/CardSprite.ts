/**
 * 一张卡牌：图集里的原画 + 底部铭牌（模型名）+ 左上费用圆章，背面是牌背图。
 *
 * 坐标约定：容器的原点在**卡的底边中点**，也就是旋转和缩放的轴（和 fanMath 那套坐标一致）。
 * 卡面因此占 x ∈ [−75, 75]、y ∈ [−225, 0]。旧版 DOM 是靠 `transform-origin: 50% 100%`
 * 做到同一件事的，Pixi 这边直接把子节点摆到负 y 上，省掉一层 pivot。
 *
 * 分三层，每层只由一个人写变换，谁也不覆盖谁（和旧版 slot / tilt / inner 三层一一对应）：
 *   this        扇形布局和拖拽跟随写 position / rotation / scale / alpha
 *   flipLayer   翻面写 scale.x（Pixi 没有三维，绕 Y 轴转用横向压扁模拟，见 setFlipAngle）
 *   tiltLayer   跟着指针的倾斜写 skew 和 scale（见 cardTilt.ts）
 *
 * 卡面上的两段文字（模型名、费用数字）在构造时就烤成纹理，之后场景里挂的是精灵。
 * 所以这张卡建好之后**没有任何能改文字内容的对象**，3.5 那条不靠自觉靠结构。
 */

import { tokens } from '@ai-duel/design'
import { Container, Rectangle, Sprite, TextStyle, type Texture } from 'pixi.js'
import type { BakedTextures } from '../fx/bakedTextures'
import { COST_BADGE_CENTER, COST_BADGE_SIZE, NAMEPLATE_HEIGHT } from '../fx/bakedTextures'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { TextTextureCache } from '../runtime/textCache'

/** 铭牌上模型名的字号。卡面 150 宽，14px 下最长的那几个模型名刚好排得开。 */
const NAME_FONT_SIZE = 14
/** 费用数字的字号，按圆章直径 38 配的。 */
const COST_FONT_SIZE = 20

/** 建一张卡要的数据。纹理由调用方给——canvas 不管资源从哪来。 */
export interface CardVisual {
  /** 这张牌的标识，扇形按它认牌。 */
  id: string
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
  readonly cardId: string
  /** 翻面层：只有它写 scale.x。 */
  readonly flipLayer: Container
  /** 倾斜层：只有 cardTilt 写它的 skew 和 scale。 */
  readonly tiltLayer: Container
  /** 卡面那一小块反光，平时 alpha 是 0。 */
  readonly glare: Sprite

  private readonly frontLayer: Container
  private readonly backLayer: Container
  /** 翻面用的角度代理。补间改它，onUpdate 再换算成 scale.x，见 setFlipAngle。 */
  readonly flipState = { angle: 0 }

  constructor(visual: CardVisual, deps: CardSpriteDeps) {
    super()
    this.cardId = visual.id
    this.label = `card:${visual.id}`

    this.flipLayer = new Container()
    this.tiltLayer = new Container()
    this.frontLayer = new Container()
    this.backLayer = new Container()
    this.backLayer.visible = false

    this.addChild(this.flipLayer)
    this.flipLayer.addChild(this.tiltLayer)
    this.tiltLayer.addChild(this.frontLayer, this.backLayer)

    this.buildFront(visual, deps)
    this.buildBack(visual)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    /*
     * 命中区显式给成卡面那个矩形，不让 Pixi 按子节点的包围盒算。
     * 两个原因：高光那张软光纹理比卡面大得多（要糊出边缘才像光），按包围盒算的话
     * 卡外一大圈都会吃到指针事件；而每帧重算包围盒本身也是白花的开销。
     * 这个矩形在卡自己的坐标里，所以 hover 放大、拖拽放大都会自动跟着一起放大。
     */
    this.hitArea = new Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT)

    this.glare = new Sprite(deps.baked.softDot)
    this.glare.anchor.set(0.5)
    // 叠加混合：反光是"多打上去的光"，不是盖一层白。不用 Filter，所以不吃离屏渲染（3.1）。
    this.glare.blendMode = 'add'
    this.glare.alpha = 0
    this.glare.setSize(CARD_WIDTH * 1.6, CARD_WIDTH * 1.6)
    this.frontLayer.addChild(this.glare)
  }

  /**
   * 按角度摆好翻面姿态：0° 是正面，180° 是背面。
   *
   * Pixi 是二维的，没有绕 Y 轴的旋转，所以用横向压扁来模拟——转到 90° 时卡正好侧对观察者、
   * 投影宽度为零，这一点和真的三维旋转完全一致，观感上分不出来。
   * 正反面在跨过 90° 那一刻硬切：那时卡宽是 0，切换看不见（旧版 DOM 那边也是这么切的，
   * 理由见 legacy 的 flipCard.ts——backface-visibility 在补间途中判断不可靠）。
   */
  setFlipAngle(angleDeg: number): void {
    const angle = ((angleDeg % 360) + 360) % 360
    const showBack = angle > 90 && angle < 270
    this.flipLayer.scale.x = Math.cos((angle * Math.PI) / 180)
    this.frontLayer.visible = !showBack
    this.backLayer.visible = showBack
    // 背面自己再横向翻一次，否则它会跟着正面一起被照成镜像。
    this.backLayer.scale.x = showBack ? -1 : 1
  }

  /** 现在朝上的是不是背面。 */
  isFacingBack(): boolean {
    return this.backLayer.visible
  }

  private buildFront(visual: CardVisual, deps: CardSpriteDeps): void {
    const art = new Sprite(visual.face)
    art.anchor.set(0.5, 1)
    // 原画是 2:3，卡面 150×225 也是 2:3，所以直接铺满，不用遮罩（遮罩要单独一次绘制）。
    art.setSize(CARD_WIDTH, CARD_HEIGHT)
    this.frontLayer.addChild(art)

    const chrome = new Sprite(deps.baked.cardChrome)
    chrome.anchor.set(0.5, 1)
    chrome.setSize(CARD_WIDTH, CARD_HEIGHT)
    this.frontLayer.addChild(chrome)

    const name = new Sprite(deps.text.get(`name|${visual.name}`, visual.name, styles().name))
    name.anchor.set(0.5, 0.5)
    name.y = -6 - NAMEPLATE_HEIGHT / 2
    // 名字太长就整体压窄，不换行也不裁字：铭牌只有一行高，换行会顶出卡外。
    const maxNameWidth = CARD_WIDTH - 24
    if (name.width > maxNameWidth) name.scale.set(maxNameWidth / name.width)
    this.frontLayer.addChild(name)

    const badge = new Sprite(deps.baked.costBadge)
    badge.anchor.set(0.5)
    badge.setSize(COST_BADGE_SIZE, COST_BADGE_SIZE)
    badge.tint = visual.accent
    badge.position.set(-CARD_WIDTH / 2 + COST_BADGE_CENTER.x, -CARD_HEIGHT + COST_BADGE_CENTER.y)
    this.frontLayer.addChild(badge)

    const costText = String(visual.cost)
    const cost = new Sprite(deps.text.get(`cost|${costText}`, costText, styles().cost))
    cost.anchor.set(0.5)
    cost.position.copyFrom(badge.position)
    this.frontLayer.addChild(cost)
  }

  private buildBack(visual: CardVisual): void {
    const back = new Sprite(visual.back)
    back.anchor.set(0.5, 1)
    back.setSize(CARD_WIDTH, CARD_HEIGHT)
    this.backLayer.addChild(back)
  }
}
