/**
 * 手牌的指针状态机：hover 抬牌、按下、走过阈值起拖、跟着指针走、松手判定。
 * 阈值和节奏抄自旧客户端 `src/ui/useCardDrag.ts` 和 `HandFan.tsx`，判定规则在 dragRules.ts。
 *
 * 跟随不用 GSAP 的 quickTo，而是每帧朝目标位收一段（见 advance）。两个理由：
 * 一是 quickTo 建的补间不在场景的活动补间账上，帧循环（3.6）会以为没事在做而停掉；
 * 二是指针每移动一次就建一条补间的话，稳态每帧堆分配那条（3.10）过不去。
 * 一次性的姿态切换（转正 + 放大）仍然走补间——那是有明确起止的一段演出。
 *
 * pressAt / moveTo / releaseAt 是给"不经过真指针的合成拖拽"留的口子，现在还没有调用方：
 * 场景的 playCard 前半段是自己按脚本排的（理由见 duelPrototype 里那段注释），
 * 只有落地之后才和真拖拽合流。留着是因为 6.6 的交互回归要靠它喂坐标。
 *
 * 这里所有跟随（拖拽的、倾斜的）都只在 advance 里推进，而 advance 只有帧循环在跑时才被调到。
 * 补间那条路由 Animator 负责叫醒帧循环，指针这条路没有补间，所以要自己调 options.wake()——
 * 漏了的地方表现是"指针在动，画面冻着"。
 */

import type { Container, FederatedPointerEvent } from 'pixi.js'
import { Point } from 'pixi.js'
import type { CardSprite } from '../components/CardSprite'
import type { CardTilt } from '../components/cardTilt'
import type { HandFan } from '../components/HandFan'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import {
  DRAG_POSE_DUR,
  DRAG_SCALE,
  type DropZoneRect,
  dragGestureOf,
  resolveDrop,
} from './dragRules'

/**
 * 指针离开卡牌后延迟这么久才缩回去。
 *
 * 几何上放大后的卡已经盖住了自己原来的位置，但补间途中卡还没长到最大，
 * 卡角附近会短暂空出几个像素。这点延迟让"扫过空档又立刻回来"的指针不会触发一次缩放。
 */
const LEAVE_DELAY_MS = 50

/** 跟随指针的时间常数（秒）。旧版是 0.18s 的 quickTo，换算成指数收敛就是它的三分之一。 */
const FOLLOW_TAU = 0.18 / 3

export interface HandPointerOptions {
  stage: Container
  fan: HandFan
  /** 被拖起来的牌画在这一层，它在扇形之上。 */
  dragLayer: Container
  animator: Animator
  /** 现在的出牌区（视口坐标）。视口一变就跟着变，所以是函数不是值。 */
  dropZone: () => DropZoneRect
  /** 视口坐标 → 手牌容器坐标。 */
  toFanLocal: (globalX: number, globalY: number) => { x: number; y: number }
  /** 手牌容器坐标 → 视口坐标，连缩放一起换算。 */
  fanToWorld: (x: number, y: number, scale: number) => { x: number; y: number; scale: number }
  /** 这张牌的倾斜跟随，没有就是这一档不做倾斜。 */
  tiltFor: (card: CardSprite) => CardTilt | undefined
  /** 玩家把牌拖进出牌区松手了，或者鼠标轻点了一下。 */
  onPlay: (card: CardSprite) => void
  /** 现在允不允许出牌。演出期间整排冻住。 */
  enabled: () => boolean
  /**
   * 叫醒帧循环。
   *
   * 这个回调是必需的，不是可选的优化：跟随和倾斜都只在 advance 里推进，而 advance 只有
   * 帧循环在跑的时候才被调到。没有补间在播时帧循环是停着的（3.6），指针再怎么动都没人画，
   * 卡面就冻在上一帧——表现是"抬起来的牌不跟着鼠标倾斜、高光根本不出现"。
   * 补间那条路由 Animator 自己叫醒（见场景里 new Animator 那行），指针这条路只能自己叫。
   */
  wake: () => void
}

interface PressState {
  card: CardSprite
  pointerId: number
  pointerType: string
  originX: number
  originY: number
  x: number
  y: number
  dragging: boolean
  targetX: number
  targetY: number
}

export class HandPointer {
  private readonly options: HandPointerOptions
  private press: PressState | null = null
  private hovered: CardSprite | null = null
  /** 指针离开之后还剩多少毫秒才真的收回。负数表示没有在倒计时。 */
  private leaveCountdown = -1
  private readonly scratch = new Point()

  constructor(options: HandPointerOptions) {
    this.options = options
    const stage = options.stage
    stage.on('globalpointermove', this.onGlobalMove)
    stage.on('pointerup', this.onUp)
    stage.on('pointerupoutside', this.onUp)
    stage.on('pointercancel', this.onCancel)
  }

  /** 给一张新牌挂上指针监听。牌被打出去之后调用方负责 destroy，监听跟着一起没。 */
  bind(card: CardSprite): void {
    card.on('pointerover', () => this.onOver(card))
    card.on('pointerout', () => this.onOut(card))
    card.on('pointerdown', (event: FederatedPointerEvent) => this.onDown(card, event))
  }

  /** 现在有没有牌被拖着。 */
  get dragging(): CardSprite | null {
    return this.press?.dragging === true ? this.press.card : null
  }

  /**
   * 推进一帧：让被拖的牌朝指针收一段，并处理 hover 的延迟收回。
   * 返回还有没有事情在做——拖拽期间恒为 true，帧循环不能停。
   */
  advance(deltaMs: number): boolean {
    let busy = false
    if (this.leaveCountdown >= 0) {
      this.leaveCountdown -= deltaMs
      if (this.leaveCountdown < 0) {
        this.leaveCountdown = -1
        this.collapseHover()
      }
      busy = true
    }

    const press = this.press
    if (press?.dragging === true) {
      const k = 1 - Math.exp(-deltaMs / 1000 / FOLLOW_TAU)
      const card = press.card
      card.x += (press.targetX - card.x) * k
      card.y += (press.targetY - card.y) * k
      busy = true
    }
    return busy
  }

  /** 合成一次按下。场景的 playCard 用它走真指针那条路。 */
  pressAt(card: CardSprite, x: number, y: number, pointerType = 'mouse'): void {
    this.begin(card, x, y, -1, pointerType)
  }

  /** 合成一次移动。 */
  moveTo(x: number, y: number): void {
    this.handleMove(x, y)
  }

  /** 合成一次松手，返回这次拖拽的结局。 */
  releaseAt(x: number, y: number): void {
    this.handleUp(x, y)
  }

  destroy(): void {
    const stage = this.options.stage
    stage.off('globalpointermove', this.onGlobalMove)
    stage.off('pointerup', this.onUp)
    stage.off('pointerupoutside', this.onUp)
    stage.off('pointercancel', this.onCancel)
  }

  private onOver(card: CardSprite): void {
    // 只要还按着（不管进没进入拖拽）就不接 hover：指针被捕获之后，
    // 各浏览器发不发、什么时候发边界事件并不统一，与其猜它们的行为，不如在这里挡掉。
    if (this.press !== null) return
    this.leaveCountdown = -1
    if (this.hovered === card) return
    if (this.hovered !== null) this.options.tiltFor(this.hovered)?.release()
    this.hovered = card
    const index = this.options.fan.laid().indexOf(card)
    this.options.fan.setHover(index)
  }

  private onOut(card: CardSprite): void {
    if (this.press !== null || this.hovered !== card) return
    this.leaveCountdown = LEAVE_DELAY_MS
    // 倒计时是在 advance 里减的，不叫醒帧循环就永远减不到零，抬起来的牌收不回去。
    this.options.wake()
  }

  private collapseHover(): void {
    if (this.hovered === null) return
    this.options.tiltFor(this.hovered)?.release()
    this.hovered = null
    this.options.fan.setHover(-1)
  }

  private readonly onGlobalMove = (event: FederatedPointerEvent): void => {
    if (!this.samePointer(event)) return
    this.handleMove(event.global.x, event.global.y)
  }

  private readonly onUp = (event: FederatedPointerEvent): void => {
    if (!this.samePointer(event)) return
    this.handleUp(event.global.x, event.global.y)
  }

  /**
   * 这条事件是不是当前这次按下的那根指针发的。
   *
   * 多指仍然不管：第二根手指按上来不会把牌抢走，也不会开出第二次拖拽。
   * 还没按下时（press 为 null）一律放行——那时的移动只用来喂倾斜跟随。
   * 合成事件登记的 pointerId 是 −1，真指针不会是这个值，所以它只认自己那条合成路径。
   */
  private samePointer(event: FederatedPointerEvent): boolean {
    const press = this.press
    return press === null || press.pointerId < 0 || press.pointerId === event.pointerId
  }

  private readonly onCancel = (): void => {
    const press = this.press
    if (press === null) return
    this.press = null
    if (press.dragging) this.returnCard(press.card)
  }

  private onDown(card: CardSprite, event: FederatedPointerEvent): void {
    // 只认主指针的主键：中键、右键、以及多指里的第二根手指都不该把牌抓起来。
    if (!event.isPrimary || event.button !== 0) return
    if (!this.options.enabled()) return
    this.begin(card, event.global.x, event.global.y, event.pointerId, event.pointerType)
  }

  private begin(
    card: CardSprite,
    x: number,
    y: number,
    pointerId: number,
    pointerType: string,
  ): void {
    this.press = {
      card,
      pointerId,
      pointerType,
      originX: x,
      originY: y,
      x,
      y,
      dragging: false,
      targetX: 0,
      targetY: 0,
    }
  }

  private handleMove(x: number, y: number): void {
    const press = this.press
    if (press === null) {
      this.updateTilt(x, y)
      return
    }
    press.x = x
    press.y = y
    if (!press.dragging) {
      // 手牌底下没有竖向滚动区，所以不开滚动优先那套判定（scrollGuard 恒为 false）。
      const gesture = dragGestureOf({
        dx: x - press.originX,
        dy: y - press.originY,
        scrollGuard: false,
      })
      if (gesture !== 'drag') return
      this.beginDrag(press)
    }
    const lift = press.pointerType === 'mouse' ? 0 : (DRAG_SCALE * CARD_HEIGHT) / 2
    press.targetX = x
    press.targetY = y - lift
    /*
     * 跟随也是在 advance 里收的。
     *
     * 今天这一次其实是白叫的：拖拽期间 advance 恒报"还在忙"，帧循环压根不会停。
     * 留着是因为那个"恒为真"哪天很容易被改掉——比如加一条"卡已经追上指针就别再报忙了"，
     * 那时候手停一下再动，画面就冻住了，而且现场看不出和帧循环有关。
     * wake() 在循环已经在跑时直接返回，留着不花钱。
     */
    this.options.wake()
  }

  /**
   * 真正进入拖拽：把牌从扇形里摘出去、挪到拖拽层、换成拖拽姿态。
   *
   * 摘出去之后剩下的牌按"少了一张"重排，手牌自己合拢（炉石就是这样）。
   * 倾斜要硬归零——指针已经被捕获，等不到"指针离开"自己来收手，
   * 不归零就会拖着一张歪的牌满屏找落点。
   */
  private beginDrag(press: PressState): void {
    const { fan, dragLayer, animator, fanToWorld, tiltFor } = this.options
    const card = press.card
    tiltFor(card)?.reset()
    this.hovered = null
    this.leaveCountdown = -1

    const world = fanToWorld(card.x, card.y, card.scale.x)
    fan.detach(card)
    animator.killTweensOf(card)
    animator.killTweensOf(card.scale)
    dragLayer.addChild(card)
    card.position.set(world.x, world.y)
    card.scale.set(world.scale)
    press.dragging = true
    press.targetX = world.x
    press.targetY = world.y

    // 姿态：转正 + 放大。位置归上面那套逐帧跟随管，两边写的属性不重叠。
    animator.tween(card, { rotation: 0, duration: DRAG_POSE_DUR, ease: 'power2.out' })
    animator.tween(card.scale, {
      x: DRAG_SCALE,
      y: DRAG_SCALE,
      duration: DRAG_POSE_DUR,
      ease: 'power2.out',
    })
  }

  private handleUp(x: number, y: number): void {
    const press = this.press
    if (press === null) return
    this.press = null
    const outcome = resolveDrop({
      pointerX: x,
      pointerY: y,
      zone: this.options.dropZone(),
      dragging: press.dragging,
      enabled: this.options.enabled(),
      moved: Math.hypot(x - press.originX, y - press.originY),
      scrollGuard: false,
    })
    if (outcome === 'play') {
      this.options.onPlay(press.card)
      return
    }
    if (outcome === 'tap') {
      // 鼠标点一下就打出；触屏点一下只是把牌抬起来看清楚——手指划过屏幕太容易蹭出一次点击，
      // 而出牌不可撤销，所以触屏不走这条路（旧版触屏还要再点一颗「打出」，原型里先只抬牌）。
      if (press.pointerType === 'mouse') this.options.onPlay(press.card)
      else this.onOver(press.card)
      return
    }
    if (press.dragging) this.returnCard(press.card)
  }

  /** 没落进出牌区：把牌送回扇形。 */
  private returnCard(card: CardSprite): void {
    const { fan } = this.options
    // 先挪回扇形容器再补间：位置是扇形坐标系里的，留在拖拽层上补间等于飞去另一个地方。
    // 收回去要走 adoptInOrder 而不是 addChild：后者把牌追加到末尾，这张牌就永远压在整排之上了。
    const local = this.options.toFanLocal(card.x, card.y)
    fan.adoptInOrder(card)
    card.position.set(local.x, local.y)
    fan.returnToFan(card)
  }

  /** 指针在放大的那张牌上移动时，把相对位置喂给倾斜跟随。 */
  private updateTilt(x: number, y: number): void {
    const card = this.hovered
    if (card === null) return
    const tilt = this.options.tiltFor(card)
    if (tilt === undefined) return
    this.scratch.set(x, y)
    const local = card.toLocal(this.scratch, undefined, this.scratch)
    // 卡面在自己的坐标里占 x ∈ [−75, 75]、y ∈ [−225, 0]（原点在底边中点）。
    tilt.setPointer(local.x / CARD_WIDTH + 0.5, local.y / CARD_HEIGHT + 1)
    // 倾斜和高光都要等 advance 收敛，抬起的补间早就演完了，这时候帧循环停着，得自己叫醒。
    this.options.wake()
  }
}
