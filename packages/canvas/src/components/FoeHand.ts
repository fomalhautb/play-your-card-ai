/**
 * 对手手牌：倒挂在视口顶边的一把牌背（需求单卡牌 A 的牌背那一档）。
 *
 * 几何完全复用 `layout/fanMath.ts` 的那套公式，只是换一组参数（`OPPONENT_FAN`）
 * 并把整个容器转 180°——于是「往下沉」自动变成「往上沉」、「两端向下垂」变成「两端向上垂」，
 * 一套数学管两边（这条约定写在 fanMath 的文件头）。整排还按 `CARD_SCALE` 缩了一号。
 *
 * 这里只画牌背、不画牌面：本项目不防作弊（架构 4.1），客人手里其实有对手的完整手牌数据，
 * 但把它明晃晃摊在屏幕上没法玩。所以这个组件连 `CardVisual` 都不收，只要一张牌背纹理。
 *
 * 张数由 `setCount` 说了算，组件自己不记牌。多出来的牌从视口外飞进来（发牌），
 * 少掉的直接摘（那张牌此刻已经被展示层接管，正飞向屏幕中央——见 `takeCard`）。
 */

import { Container, Sprite, type Texture } from 'pixi.js'
import { DEAL_CARD_MS, DEAL_STAGGER_MS } from '../director/timings'
import { CARD_HEIGHT, CARD_WIDTH, fanTransform, OPPONENT_FAN } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import { killAndDestroy } from '../runtime/dispose'

/**
 * 对手那排整体缩到多大，以及新牌从多远的地方飞进来。
 * 抄黑客松版的 `ui/OpponentFan.tsx`（`CARD_SCALE 0.64`、`ENTER_OFFSET 140`）。
 */
const CARD_SCALE = 0.64
const ENTER_OFFSET = 140

export interface FoeHandDeps {
  animator: Animator
  /**
   * 隐藏牌背的纹理。
   *
   * 给的该是**对手专用**的那张（烤出来的纸白底 + 藏青纹章，见 fx/cardShapes.ts），
   * 不是自己人那张美术卡背——AI 牌和技能牌的卡背长得不一样，用自己人那套等于泄露牌种。
   */
  back: Texture
}

export interface FoeHandOptions {
  /** 这排扇形可以铺开多宽（扇形自己的坐标系里的像素，已经把缩放折算掉了）。 */
  areaWidth: number
}

export class FoeHand extends Container {
  private readonly deps: FoeHandDeps
  /** 真正排扇形的那一层。整层转 180°，几何照玩家那套算。 */
  private readonly fan = new Container()
  private readonly cards: Sprite[] = []
  private areaWidth: number

  constructor(options: FoeHandOptions, deps: FoeHandDeps) {
    super()
    this.deps = deps
    this.areaWidth = options.areaWidth
    this.label = 'foe-hand'
    // 对手的牌不接指针事件：它们只是"对面手上还有几张"的告示，点不出任何东西。
    this.eventMode = 'none'
    this.fan.rotation = Math.PI
    this.fan.scale.set(CARD_SCALE)
    this.addChild(this.fan)
  }

  /** 现在画着几张。 */
  get count(): number {
    return this.cards.length
  }

  /** 视口变了：重新算可用宽度并重排。 */
  setAreaWidth(width: number): void {
    if (this.areaWidth === width) return
    this.areaWidth = width
    this.layout()
  }

  /**
   * 手上有几张。多了就飞进来，少了就直接摘。
   *
   * 摘的是**最后一张**而不是某张具体的牌：牌背之间没有区别，摘哪张画面上都一样，
   * 而"对手打出的那张"此刻已经被展示层借走了（见 takeCard），不在这排里。
   * 返回这一批发牌演多久（毫秒），和 `deal` cue 的 `durationMs` 是同一个算法。
   */
  setCount(count: number): number {
    const target = Math.max(0, Math.round(count))
    while (this.cards.length > target) {
      const card = this.cards.pop()
      if (card === undefined) break
      // 先掐补间再销毁：这排牌是错开起飞的，被摘掉的那张身上很可能还挂着一条**没开始**的
      // 补间（delay 还没走完）。GSAP 要到它真的开跑那一刻才去读目标的属性，
      // 那时对象已经拆了，读出来是 null，当场抛错。
      killAndDestroy(this.deps.animator, card)
    }
    const added = target - this.cards.length
    for (let i = 0; i < added; i += 1) this.cards.push(this.spawn())
    this.layout(added)
    if (added === 0) return 0
    return DEAL_CARD_MS + (added - 1) * DEAL_STAGGER_MS
  }

  /**
   * 把第 index 张牌背摘出来交给调用方（强制展示要从它的位置起飞）。
   *
   * 返回的精灵已经从这排里摘掉，但**还没销毁**，而且位置换算成了这个组件自己的坐标——
   * 调用方拿它当起飞点，然后自己销毁。取不到（下标越界）就返回 null，
   * 调用方退回"从屏幕中央淡入"那条降级路（cue 里的 `fromOrigin: false`）。
   */
  takeCard(index: number): { x: number; y: number } | null {
    const card = this.cards[index]
    if (card === undefined) return null
    this.cards.splice(index, 1)
    const point = this.fan.toGlobal(card.position)
    const local = this.toLocal(point)
    killAndDestroy(this.deps.animator, card)
    this.layout()
    return { x: local.x, y: local.y }
  }

  /** 建一张牌背，摆在"还没飞进来"的起点上。 */
  private spawn(): Sprite {
    const card = new Sprite(this.deps.back)
    // 锚点在底边中点，和 CardSprite 的坐标约定一致——扇形那套公式吃的就是这个原点。
    card.anchor.set(0.5, 1)
    card.setSize(CARD_WIDTH, CARD_HEIGHT)
    card.alpha = 0
    this.fan.addChild(card)
    return card
  }

  /**
   * 把每张牌补间到它该在的位置。
   *
   * `entering` 是这一批新加进来的张数，它们排在最后，各自按 `DEAL_STAGGER_MS` 错开起飞、
   * 起点在扇形外侧 `ENTER_OFFSET` 处。已经在排里的那些只是重排，不错开。
   */
  private layout(entering = 0): void {
    const total = this.cards.length
    const firstNew = total - entering
    this.cards.forEach((card, index) => {
      const pose = fanTransform(index, total, this.areaWidth, OPPONENT_FAN)
      const rotation = (pose.rotation * Math.PI) / 180
      const isNew = index >= firstNew
      if (isNew) {
        card.position.set(pose.x, pose.y + ENTER_OFFSET)
        card.rotation = rotation
      }
      this.deps.animator.tween(card, {
        x: pose.x,
        y: pose.y,
        rotation,
        alpha: 1,
        duration: DEAL_CARD_MS / 1000,
        delay: isNew ? ((index - firstNew) * DEAL_STAGGER_MS) / 1000 : 0,
        ease: 'power2.out',
        overwrite: 'auto',
      })
    })
  }
}
