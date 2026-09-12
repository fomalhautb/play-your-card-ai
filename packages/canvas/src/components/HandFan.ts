/**
 * 扇形手牌：一排牌怎么摆、怎么抬、怎么让位、新牌怎么飞进来。
 * 节奏和几何抄自旧客户端 `src/ui/HandFan.tsx`，实现全部重写成 Pixi。
 *
 * 它只管排布，不管出牌：拖拽、命中判定、打出之后飞去哪，都由场景在外面做。
 * 被拖起来或已经打出的牌用 detach 摘出去，剩下的按"少了一张"重算扇形，手牌会自己合拢。
 *
 * 层级只有"右边的牌压住左边的"这一个固定顺序（和炉石一致），hover 和返程都不改它。
 * Pixi 的绘制顺序就是子节点顺序，所以这条不用 zIndex 排序——排序要每帧比一遍，
 * 而被拖起来的那张牌本来就该交给场景的拖拽层去画（那一层在扇形之上）。
 * 代价是牌从拖拽层回来时得自己插回原来那一位，见 adoptInOrder。
 */

import { Container } from 'pixi.js'
import { type FanGeometry, LAYOUT_DUR } from '../layout/fanMath'
import {
  DEAL_STAGGER,
  ENTER_SINK,
  HOVER_DUR,
  HOVER_EASE,
  handPoses,
  LAYOUT_EASE,
  type SlotPose,
} from '../layout/handLayout'
import type { Animator } from '../runtime/animator'
import type { CardSprite } from './CardSprite'
import { CASTING_LIFT } from './TargetingLayer'

/**
 * 灰墨态下整排往下沉多少。
 *
 * 抄黑客松 `.hand-fan[data-locked]` 的 `translateY(12px)`：出不了牌的时候整排往下缩一点，
 * 和压暗一起说明「这排现在不归你动」。
 */
const HAND_SINK = 12

/** hover 引起的补间要更快，重排则用统一的慢一点的节奏。 */
export type LayoutMode = 'hover' | 'reflow'

export interface HandFanOptions {
  animator: Animator
  geometry: FanGeometry
  /** 这排扇形可以铺开多宽（扇形自己的坐标系里的像素）。 */
  areaWidth: number
}

/** 一张新牌从哪儿飞进来。null 表示没有牌库位置，退回"从基准位下方淡入"。 */
export type DealOrigin = SlotPose | null

export class HandFan extends Container {
  private readonly animator: Animator
  private readonly geometry: FanGeometry
  private areaWidth: number
  /** 排在扇形里的牌，顺序就是左到右。 */
  private readonly cards: CardSprite[] = []
  /** 摘出去不参与排布的牌（正在拖、已经打出等结果）。 */
  private readonly detached = new Set<string>()
  private hoverIndex = -1
  /** 正在等玩家选目标的那张牌，它要从扇形里抬起来。没有就是 null。 */
  private castingId: string | null = null

  constructor(options: HandFanOptions) {
    super()
    this.animator = options.animator
    this.geometry = options.geometry
    this.areaWidth = options.areaWidth
    this.label = 'hand-fan'
  }

  /** 参与排布的牌数。摘出去的不算。 */
  get laidCount(): number {
    return this.laid().length
  }

  /** 手上一共有几张牌，含摘出去的。 */
  get size(): number {
    return this.cards.length
  }

  cardAt(index: number): CardSprite | undefined {
    return this.cards[index]
  }

  /** 这张牌在手牌数组里的下标（含摘出去的），没有就是 −1。 */
  indexOf(card: CardSprite): number {
    return this.cards.indexOf(card)
  }

  /** 视口变了：重新算可用宽度并重排。 */
  setAreaWidth(width: number): void {
    if (this.areaWidth === width) return
    this.areaWidth = width
    this.layout('reflow')
  }

  /**
   * 把一张新牌放进扇形，并摆到它的**起飞姿态**——这一步不建任何补间。
   *
   * 起飞和落位分成两步，是因为开局要一次放好几张、再让它们错开时间依次飞。
   * 合成一步的话每放一张都要重排一次，前面几张会被反复打断。
   * 放完之后由调用方统一调一次 layout，并用 delays 给这一批错开起飞时间。
   *
   * @param from 起飞姿态。给了就从那儿飞过来（开局发牌是从牌库位置起飞），
   *   传 null 就退回"在基准位下方沉 ENTER_SINK、淡入着滑上来"。
   */
  insert(card: CardSprite, from: DealOrigin): void {
    this.cards.push(card)
    this.addChild(card)

    if (from === null) {
      // 退回的那条路要按"加进来之后"的排布算起点：新牌一进来整排就重新分间距了。
      const target = this.poseAt(this.laid().indexOf(card))
      applyPose(card, { ...target, y: target.y + ENTER_SINK, scale: 0.85 })
      card.alpha = 0
      return
    }
    applyPose(card, from)
    // 从牌库飞过来的那张一开始就是不透明的：起点在牌库那摞牌上，本来就看得见。
    card.alpha = 1
  }

  /** 一批新牌各自错开多久起飞（秒）。第 i 张就是 i × DEAL_STAGGER。 */
  static staggerOf(order: number): number {
    return order * DEAL_STAGGER
  }

  /** 把一张牌从手牌里彻底拿走（打出成功）。调用方负责销毁或另作他用。 */
  remove(card: CardSprite): void {
    const index = this.cards.indexOf(card)
    if (index >= 0) this.cards.splice(index, 1)
    this.detached.delete(card.instanceId)
    if (this.hoverIndex >= this.laid().length) this.hoverIndex = -1
    this.layout('reflow')
  }

  /**
   * 把一张牌摘出排布（拖起来、或者已经打出正在等结果）。
   *
   * 摘出去之后它的位置归调用方管，排布连碰都不能碰——否则跟着光标的补间会被布局补间抢走。
   * 剩下的牌按"少了一张"重算，手牌当场合拢。
   */
  detach(card: CardSprite): void {
    if (this.detached.has(card.instanceId)) return
    this.detached.add(card.instanceId)
    this.hoverIndex = -1
    this.layout('reflow')
  }

  /** 放回排布（拖拽取消，牌要飞回扇形）。 */
  reattach(card: CardSprite): void {
    if (!this.detached.delete(card.instanceId)) return
    this.layout('reflow')
  }

  /**
   * 把一张挂在别的容器上的牌收回扇形容器，并插回它原来的层级。
   *
   * 拖起来的牌被挪到了拖拽层（那一层在扇形之上），放回来时**不能用 addChild**：
   * 那是追加到子节点列表末尾，而 Pixi 的绘制顺序就是子节点顺序，这张牌于是压在了整排之上。
   * 扇形的层级规矩只有"右边的压左边的"一条（和旧版一致，见类头），中间那张牌压住右邻居
   * 一眼就能看出错位。
   *
   * 插到第几位不能直接拿它在 cards 里的下标：拖拽和出牌期间会有牌被挪到别的容器上
   * （拖拽层、战场层），那些牌还留在 cards 里，却已经不是扇形的子节点了。
   * 所以数一遍"排在它前面、而且此刻真挂在扇形上"的有几张，那个数才是子节点列表里的位置。
   */
  adoptInOrder(card: CardSprite): void {
    const index = this.cards.indexOf(card)
    if (index < 0) {
      this.addChild(card)
      return
    }
    let at = 0
    for (let i = 0; i < index; i += 1) {
      if (this.cards[i]?.parent === this) at += 1
    }
    this.addChildAt(card, at)
  }

  /** 这张牌现在是不是被摘出去了。 */
  isDetached(card: CardSprite): boolean {
    return this.detached.has(card.instanceId)
  }

  /**
   * 抬起第 index 张（按参与排布的顺序数），传 −1 收回。
   * 换牌和收回都走这里，重复设同一张不会白建补间。
   */
  setHover(index: number): void {
    if (this.hoverIndex === index) return
    this.hoverIndex = index
    this.layout('hover')
  }

  /** 现在抬起来的是第几张（参与排布的下标），没有就是 −1。 */
  get hovered(): number {
    return this.hoverIndex
  }

  /**
   * 整排沉下去（灰墨态）或者回到原位。
   *
   * 沉的是**整层**而不是逐张改 y：逐张改要和 hover、让位、施放抬起三套姿态抢同一个属性，
   * 而它们各自都有自己的补间。写 `pivot` 不碰任何一张牌的姿态——版式那边写的是
   * `position` 和 `scale`（见 scenes/duel/parts.ts），两边不重叠。
   */
  setSunk(sunk: boolean): void {
    const target = sunk ? -HAND_SINK : 0
    if (this.pivot.y === target) return
    this.animator.tween(this.pivot, {
      y: target,
      duration: HOVER_DUR,
      ease: LAYOUT_EASE,
      overwrite: 'auto',
    })
  }

  /**
   * 哪张牌正在等玩家选目标：它从扇形里抬起 `CASTING_LIFT`，其余的位置不动。
   *
   * 只抬不放大——放大就又把战场挡住了，而选目标时战场正是要看的地方（同黑客松）。
   */
  setCasting(instanceId: string | null): void {
    if (this.castingId === instanceId) return
    this.castingId = instanceId
    this.layout('hover')
  }

  /** 第 index 张牌（参与排布的下标）此刻该摆成什么样。 */
  poseAt(index: number): SlotPose {
    const poses = handPoses(this.laid().length, this.areaWidth, this.geometry, this.hoverIndex)
    return poses[index] ?? { x: 0, y: this.geometry.sink, rotation: 0, scale: 1 }
  }

  /**
   * 把每张牌补间到它当前该在的位置。
   *
   * 每张牌两条补间：一条管位置、旋转和透明度，一条管缩放。
   * 分成两条是因为 Pixi 的 scale 是个子对象（scale.x / scale.y），GSAP 要单独补它；
   * 两条补间写的属性不重叠，同时跑没有冲突。都开 overwrite: 'auto'——
   * 快速扫过多张牌时，旧补间要被新补间干净地接管，不能各改各的。
   */
  layout(mode: LayoutMode, delays?: ReadonlyMap<string, number>): void {
    const laid = this.laid()
    const poses = handPoses(laid.length, this.areaWidth, this.geometry, this.hoverIndex)
    const duration = mode === 'hover' ? HOVER_DUR : LAYOUT_DUR

    laid.forEach((card, index) => {
      const pose = poses[index]
      if (pose === undefined) return
      const hovered = index === this.hoverIndex
      // 正在施放的那张从它的基准位再抬一截；它这时不会同时被 hover（整排都不接指针）。
      const lift = card.instanceId === this.castingId ? CASTING_LIFT : 0
      const delay = delays?.get(card.instanceId) ?? 0
      this.animator.tween(card, {
        x: pose.x,
        y: pose.y - lift,
        rotation: (pose.rotation * Math.PI) / 180,
        alpha: 1,
        duration,
        delay,
        // 抬起来那一下冲过目标位再弹回来，才有"牌被挑出来"的手感；落位一律用同一条缓动。
        ease: hovered ? HOVER_EASE : LAYOUT_EASE,
        overwrite: 'auto',
      })
      this.animator.tween(card.scale, {
        x: pose.scale,
        y: pose.scale,
        duration,
        delay,
        ease: hovered ? HOVER_EASE : LAYOUT_EASE,
        overwrite: 'auto',
      })
    })
  }

  /** 让某张摘出去的牌飞回它在扇形里的位置。 */
  returnToFan(card: CardSprite): void {
    this.reattach(card)
    const index = this.laid().indexOf(card)
    if (index < 0) return
    const pose = this.poseAt(index)
    this.animator.tween(card, {
      x: pose.x,
      y: pose.y,
      rotation: (pose.rotation * Math.PI) / 180,
      alpha: 1,
      duration: LAYOUT_DUR,
      ease: LAYOUT_EASE,
      overwrite: 'auto',
    })
    this.animator.tween(card.scale, {
      x: pose.scale,
      y: pose.scale,
      duration: LAYOUT_DUR,
      ease: LAYOUT_EASE,
      overwrite: 'auto',
    })
  }

  /** 参与排布的牌，按左到右。 */
  laid(): CardSprite[] {
    return this.cards.filter((card) => !this.detached.has(card.instanceId))
  }

  /** 全部手牌，含摘出去的。 */
  all(): readonly CardSprite[] {
    return this.cards
  }
}

/** 不补间、直接把一张牌摆到某个姿态。用来给进场动画定起点。 */
export function applyPose(card: CardSprite, pose: SlotPose): void {
  card.position.set(pose.x, pose.y)
  card.rotation = (pose.rotation * Math.PI) / 180
  card.scale.set(pose.scale)
}
