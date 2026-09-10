/**
 * 首页那一摞人物抠图：七个人各带一张发光副本，上面再压桌面弧和前景道具。
 *
 * 这一层同时负责 hover：整幅透明图不能自己收指针事件（一收就把底下四张展示卡挡死了），
 * 所以命中判定在场景级做，靠建场景时烤好的低分辨率 alpha 掩码（见 castHit.ts / castMask.ts）。
 *
 * ## 发光副本为什么垫在**本人下面一层**
 *
 * 旧版是同一张图套上「实描边 + 光晕」滤镜垫在身下。Pixi 这边不许挂 Filter（3.1），
 * 换成**同一张图放大一丁点、上一层金色 tint**：放大之后只有轮廓外那一圈露出来，
 * 于是成了一圈描边而不是糊在身上的一片光。
 * 位置关系照旧：垫在自己身下、排在更前排的人之前——那圈光会被站在前面的人挡住，
 * 就像光真的是从这个人身上发出来的。放到自己上面或整层最后，这两点都会失效。
 *
 * 放大要绕**这个人自己的重心**转，不是图片中心：抠图是整幅的，人只占其中一小块，
 * 绕图片中心放大会把人整个挪走。重心就用 alpha 掩码算出来的包围盒中心。
 */

import { tokens } from '@ai-duel/design'
import { Container, type Renderer, Sprite, type Texture } from 'pixi.js'
import { INFO_CARD_CAST, InfoCard, type InfoCardDeps } from '../../components/InfoCard'
import { killAndDestroy } from '../../runtime/dispose'
import { type AlphaMask, hitTestMasks } from './castHit'
import { bakeAlphaMasks } from './castMask'
import type { HomeCastMember } from './homeContract'
import type { HomeLayout } from './homeLayout'

/** 发光副本比本人大多少。1.008 在 1440 宽下大约是两三个像素的一圈边。 */
const GLOW_SCALE = 1.008
/** 发光副本亮到什么程度。 */
const GLOW_ALPHA = 0.9

export type CastLayerDeps = InfoCardDeps

/** 一个人在这一层里的三样东西：本人、发光副本、包围盒。 */
interface CastEntry {
  person: Sprite
  glow: Container
  mask: AlphaMask
}

export class CastLayer extends Container {
  /** 介绍卡挂在这里。它**不在**本层里——本层要跟着画走，而介绍卡按视口摆。 */
  readonly panels = new Container()

  private readonly deps: CastLayerDeps
  private readonly cast: readonly HomeCastMember[]
  private readonly entries: CastEntry[] = []
  private readonly occluders: { sprite: Sprite; mask: AlphaMask }[] = []
  private layout: HomeLayout | null = null
  private hovered: number | null = null

  constructor(
    renderer: Renderer,
    cast: readonly HomeCastMember[],
    occluderTextures: readonly Texture[],
    deps: CastLayerDeps,
  ) {
    super()
    this.deps = deps
    this.cast = cast
    this.label = 'home-cast'

    // 掩码一次烤完：每张都要走一趟渲染到纹理加回读，全放在建场景这一步（见 castMask.ts）。
    const castMasks = bakeAlphaMasks(
      renderer,
      cast.map((member) => member.art),
    )
    const occluderMasks = bakeAlphaMasks(renderer, occluderTextures)

    cast.forEach((member, index) => {
      const glow = new Container()
      const glowSprite = new Sprite(member.art)
      glowSprite.tint = tokens.color.home.inkLit
      glow.addChild(glowSprite)
      glow.alpha = 0
      // 藏起来是为了省绘制调用：七张全屏精灵常驻会白白多七次半透明填充（3.2）。
      glow.visible = false
      const person = new Sprite(member.art)
      this.addChild(glow, person)
      this.entries.push({ person, glow, mask: castMasks[index] ?? emptyEntryMask() })
    })

    occluderTextures.forEach((texture, index) => {
      const sprite = new Sprite(texture)
      this.addChild(sprite)
      this.occluders.push({ sprite, mask: occluderMasks[index] ?? emptyEntryMask() })
    })
  }

  /** 摆一档版式：整层挪到画那一块上，每张图铺满它。 */
  place(layout: HomeLayout): void {
    this.layout = layout
    const { stage } = layout
    this.position.set(stage.x, stage.y)
    for (const entry of this.entries) {
      entry.person.setSize(stage.width, stage.height)
      const child = entry.glow.children[0]
      if (child instanceof Sprite) child.setSize(stage.width, stage.height)
      const center = bboxCenter(entry.mask, stage.width, stage.height)
      entry.glow.pivot.set(center.x, center.y)
      entry.glow.position.set(center.x, center.y)
      entry.glow.scale.set(GLOW_SCALE)
    }
    for (const { sprite } of this.occluders) sprite.setSize(stage.width, stage.height)
    // 版式一变，介绍卡的落点也变了；重摆一遍最省事（这一步一局只发生几次）。
    this.refreshPanel()
  }

  /**
   * 指针落在谁身上（视口坐标）。没人就是 null。
   *
   * 坐标先换算成「相对那幅画的 0~1」：抠图和画等比，所以画里的归一化坐标可以直接当
   * 图片里的归一化坐标用，掩码多大都不影响。
   */
  hitTest(viewX: number, viewY: number): number | null {
    const stage = this.layout?.stage
    if (stage === undefined || stage.width <= 0 || stage.height <= 0) return null
    return hitTestMasks(
      this.entries.map((entry) => entry.mask),
      (viewX - stage.x) / stage.width,
      (viewY - stage.y) / stage.height,
      this.occluders.map((occluder) => occluder.mask),
    )
  }

  /** 现在停在谁身上。 */
  get hoveredIndex(): number | null {
    return this.hovered
  }

  /** 换一个高亮的人（null 是谁都不亮）。同一个人重复设不做任何事。 */
  setHovered(index: number | null): void {
    if (index === this.hovered) return
    const before = this.hovered
    this.hovered = index
    if (before !== null) this.fadeGlow(before, false)
    if (index !== null) this.fadeGlow(index, true)
    this.refreshPanel()
  }

  /** 拆的时候连介绍卡一起收（它挂在别人身上，不会被本层的 destroy 带走）。 */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.clearPanel()
    this.panels.destroy({ children: true })
    super.destroy(options)
  }

  private fadeGlow(index: number, lit: boolean): void {
    const entry = this.entries[index]
    if (entry === undefined) return
    if (lit) entry.glow.visible = true
    this.deps.animator.tween(entry.glow, {
      alpha: lit ? GLOW_ALPHA : 0,
      duration: lit ? tokens.duration.home.castFadeIn : tokens.duration.home.castFadeOut,
      ease: 'power2.out',
      overwrite: 'auto',
      onComplete: () => {
        if (!lit) entry.glow.visible = false
      },
    })
  }

  private clearPanel(): void {
    for (const child of this.panels.removeChildren()) killAndDestroy(this.deps.animator, child)
  }

  /**
   * 重摆介绍卡。
   *
   * 每换一个人就整块重建，不复用：`InfoCard` 建好之后没有能改内容的东西（同 Label 的理由），
   * 而这一步一秒最多发生几次、也不在动画期间，3.10 管的是稳态每帧。
   */
  private refreshPanel(): void {
    this.clearPanel()
    const layout = this.layout
    const index = this.hovered
    if (layout === null || index === null) return
    const member = this.cast[index]
    const mask = this.entries[index]?.mask
    if (member === undefined || mask === undefined) return

    const card = new InfoCard(
      {
        variant: INFO_CARD_CAST,
        width: layout.castPanel.width,
        name: member.name,
        scale: layout.castPanel.scale,
        sections: [
          { label: '人物', text: member.intro },
          { label: `技能 · ${member.skillName}`, text: member.skillText },
          ...(member.roleText === undefined ? [] : [{ label: '定位', text: member.roleText }]),
        ],
      },
      this.deps,
    )
    card.position.set(...panelSpot(card, layout, mask))
    this.panels.addChild(card)
    // 淡入比高亮晚一点起跑：换人时是两张卡在同一块地方交叉，旧的先退干净才不会叠成重影。
    card.show(tokens.duration.home.castPanelDelay)
  }
}

/** 掩码算不出包围盒时的兜底：当成整张图都是人，放大只会原地不动。 */
function emptyEntryMask(): AlphaMask {
  return { width: 0, height: 0, alpha: new Uint8Array(0), bbox: null }
}

/** 这个人在画里的重心（画的局部坐标）。没有包围盒就退回画的正中。 */
function bboxCenter(mask: AlphaMask, width: number, height: number): { x: number; y: number } {
  const box = mask.bbox
  if (box === null) return { x: width / 2, y: height / 2 }
  return { x: ((box.minX + box.maxX) / 2) * width, y: ((box.minY + box.maxY) / 2) * height }
}

/**
 * 介绍卡摆在哪（视口坐标）。
 *
 * 横向看人在画的哪半边：左半边的人把卡摆到他右侧，右半边的摆到左侧——
 * 这样卡永远朝画面中间展开，不会挤出屏幕。纵向对着他的肩膀，再夹进视口里。
 */
function panelSpot(card: InfoCard, layout: HomeLayout, mask: AlphaMask): [number, number] {
  const { stage, castPanel } = layout
  const box = mask.bbox
  if (box === null) {
    return [(layout.width - card.boxWidth) / 2, stage.y + stage.height * 0.3]
  }
  const onLeftHalf = (box.minX + box.maxX) / 2 < 0.5
  const rawX = onLeftHalf
    ? stage.x + box.maxX * stage.width + castPanel.gap
    : stage.x + box.minX * stage.width - castPanel.gap - card.boxWidth
  // 头顶往下落一点，卡片才大致对着肩膀而不是悬在头发上面。
  const rawY = stage.y + box.minY * stage.height + stage.height * 0.06
  const margin = castPanel.gap
  /*
   * 下边界卡在主入口那颗匾额的上沿，不是视口底边：介绍卡是临时浮出来的信息，
   * 压住「开始游戏」就等于把整页唯一的主操作挡了（旧版为此专门算了一个上界，
   * 用的是同一条思路——匾额顶边减去卡片估算高度）。
   */
  const bottom = Math.min(layout.height, layout.start.y) - margin
  return [
    clamp(rawX, margin, Math.max(margin, layout.width - card.boxWidth - margin)),
    clamp(rawY, margin, Math.max(margin, bottom - card.boxHeight)),
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
