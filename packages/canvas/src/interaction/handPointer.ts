/**
 * 手牌的指针状态机：按下、走过阈值起拖、跟着指针走、松手判定。
 * 阈值和节奏抄自旧客户端 `src/ui/useCardDrag.ts` 和 `HandFan.tsx`，判定规则在 dragRules.ts。
 *
 * 没按下时的那一档（停留抬牌、离开收回、跟着指针倾斜）拆在 `handHover.ts`，
 * 分界线就是「指针有没有按下去」——按下之后 hover 立刻收手，理由见那个文件的头。
 * 构造参数那张表拆在 `handPointerOptions.ts`（单看那张表也要读半屏，理由见那个文件的头）。
 *
 * 跟随不用 GSAP 的 quickTo，而是每帧朝目标位收一段（见 advance）。两个理由：
 * 一是 quickTo 建的补间不在场景的活动补间账上，帧循环（3.6）会以为没事在做而停掉；
 * 二是指针每移动一次就建一条补间的话，稳态每帧堆分配那条（3.10）过不去。
 * 一次性的姿态切换（转正 + 放大）仍然走补间——那是有明确起止的一段演出。
 *
 * pressAt / moveTo / releaseAt 是给"不经过真指针的合成拖拽"留的口子，现在的调用方只有
 * 6.6 的交互回归（canvas 的 test/duelInput.test.ts）——它按这三个入口喂坐标，
 * 断言一串动作最后发出了哪条指令。所以这三个入口要和真指针那条路**行为一致**，
 * 该问的闸（现在许不许动）一样要问。
 *
 * 这里所有跟随（拖拽的、倾斜的）都只在 advance 里推进，而 advance 只有帧循环在跑时才被调到。
 * 补间那条路由 Animator 负责叫醒帧循环，指针这条路没有补间，所以要自己调 options.wake()——
 * 漏了的地方表现是"指针在动，画面冻着"。
 */

import type { FederatedPointerEvent } from 'pixi.js'
import { Point } from 'pixi.js'
import type { CardSprite } from '../components/CardSprite'
import { hitsSeal } from '../components/cardFaceParts'
import { CARD_HEIGHT } from '../layout/fanMath'
import { DRAG_POSE_DUR, DRAG_SCALE, dragGestureOf, pointInZone, resolveDrop } from './dragRules'
import { HandHover } from './handHover'
import type { HandPointerOptions } from './handPointerOptions'

/** 跟随指针的时间常数（秒）。旧版是 0.18s 的 quickTo，换算成指数收敛就是它的三分之一。 */
const FOLLOW_TAU = 0.18 / 3

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
  /** 没按下时那一档（停留抬牌、跟着倾斜）。 */
  private readonly hover: HandHover
  /** 上一次报给调用方的落点提示档位。 */
  private dropState: 'off' | 'ready' | 'hot' = 'off'
  /** 换算指针坐标用的草稿。复用同一块，逐次指针移动不产生堆分配（3.10）。 */
  private readonly pointerScratch = new Point()

  constructor(options: HandPointerOptions) {
    this.options = options
    this.hover = new HandHover(options)
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
    let busy = this.hover.advance(deltaMs)
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

  /**
   * 合成一次按下。坐标是**舞台坐标**（真指针那条路已经在 `stagePoint` 里换算过了）。
   *
   * 和真指针那条路（onDown）一样先问一句「现在许不许动」：不问的话，锁着的时候
   * 合成拖拽照样能把牌从扇形里抓出来，只是松手时被判成取消——牌抬起来又掉回去，
   * 而真指针在这种时候是**一动不动**的。交互测试按这条口子喂坐标（见 input.ts 的文件头），
   * 两条路的行为对不上，测出来的就不是玩家会遇到的那件事。
   */
  pressAt(card: CardSprite, x: number, y: number, pointerType = 'mouse'): void {
    if (!this.options.enabled()) return
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

  /**
   * 把一张还挂在拖拽层上的牌送回扇形。「拖出去松手」不一定等于「这张牌走了」：
   * 带目标的技能牌松手之后进的是选目标态，牌得先回扇形再抬起来等玩家点。
   *
   * 没被摘出扇形的那张直接不管。调用方（input.ts 的 onPlay）在每一条「这张牌没出成」的
   * 分支上都会调它一次，而那些分支里有一半是**鼠标轻点**走过来的——那张牌压根没离开过扇形，
   * 它的 x/y 是扇形坐标；照着送会被 `returnCard` 当成舞台坐标再换算一遍，牌当场飞到别处
   * 再飞回来。这道闸让调用方可以无脑调，不必自己分辨这一下是拖的还是点的。
   */
  returnToFan(card: CardSprite): void {
    if (!this.options.fan.isDetached(card)) return
    this.returnCard(card)
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
    this.hover.enter(card)
  }

  private onOut(card: CardSprite): void {
    if (this.press !== null) return
    this.hover.leave(card)
  }

  private readonly onGlobalMove = (event: FederatedPointerEvent): void => {
    if (!this.samePointer(event)) return
    const at = this.stagePoint(event)
    this.handleMove(at.x, at.y)
  }

  private readonly onUp = (event: FederatedPointerEvent): void => {
    if (!this.samePointer(event)) return
    const at = this.stagePoint(event)
    this.handleUp(at.x, at.y)
  }

  /**
   * 事件带的视口坐标换成舞台坐标。
   *
   * 舞台在桌面档是缩放居中过的（1672×941 的死版式放进视口），不换算的话拖着的牌会
   * 一边走一边偏，落点判定也会整体错位。手机档舞台是恒等变换，这一步等于原样返回。
   */
  private stagePoint(event: FederatedPointerEvent): Point {
    this.pointerScratch.copyFrom(event.global)
    return this.options.stage.toLocal(this.pointerScratch, undefined, this.pointerScratch) as Point
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
    this.reportDrop('off')
    if (press.dragging) this.returnCard(press.card)
  }

  private onDown(card: CardSprite, event: FederatedPointerEvent): void {
    // 只认主指针的主键：中键、右键、以及多指里的第二根手指都不该把牌抓起来。
    if (!event.isPrimary || event.button !== 0) return
    if (!this.options.enabled()) return
    const at = this.stagePoint(event)
    this.begin(card, at.x, at.y, event.pointerId, event.pointerType)
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
      this.hover.point(x, y)
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
    this.reportDrop(pointInZone(x, y, this.options.dropZone()) ? 'hot' : 'ready')
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
    this.hover.cancel()
    // 拖着的那张离手最远，投影跟着它（同 hover 那一档，见 CardSprite.setLifted）。
    card.setLifted(true)
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
    this.reportDrop('ready')

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
    this.reportDrop('off')
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
      // 牌要离手了：影子先落下，接下来它是被演出接管的一张飞行卡，不再"浮在手上"。
      press.card.setLifted(false)
      this.options.onPlay(press.card)
      return
    }
    if (outcome === 'tap') {
      /*
       * 先看这一下是不是冲着问号章去的：点章翻到背面，翻过去之后点**整张牌**都翻回来
       *（章画在正面那一层上，背面朝上时跟着一起看不见）。判在打出之前：两件事共用同一次
       * 点击，翻面优先——出牌不可撤销，翻面可以。
       */
      if (this.flipTapped(press.card, x, y)) {
        this.options.onFlip?.(press.card)
        return
      }
      // 鼠标点一下就打出；触屏点一下只是把牌抬起来看清楚——手指划过屏幕太容易蹭出一次点击，
      // 而出牌不可撤销，所以触屏不走这条路（旧版触屏还要再点一颗「打出」，原型里先只抬牌）。
      if (press.pointerType === 'mouse') this.options.onPlay(press.card)
      else this.onOver(press.card)
      return
    }
    if (press.dragging) this.returnCard(press.card)
  }

  /** 这一下点的是不是「翻面」：正面朝上时要点在问号章上，背面朝上时点哪儿都算。 */
  private flipTapped(card: CardSprite, stageX: number, stageY: number): boolean {
    if (!card.flippable || this.options.onFlip === undefined) return false
    if (card.isFacingBack()) return true
    this.pointerScratch.set(stageX, stageY)
    const at = card.toLocal(this.pointerScratch, this.options.stage, this.pointerScratch)
    return hitsSeal(at.x, at.y)
  }

  /** 落点提示换一档。没变就不报——调用方那边一档对一次 visible 的开关。 */
  private reportDrop(state: 'off' | 'ready' | 'hot'): void {
    if (state === this.dropState) return
    this.dropState = state
    this.options.onDropState?.(state)
  }

  /** 没落进出牌区：把牌送回扇形。 */
  private returnCard(card: CardSprite): void {
    card.setLifted(false)
    const { fan } = this.options
    // 先挪回扇形容器再补间：位置是扇形坐标系里的，留在拖拽层上补间等于飞去另一个地方。
    // 收回去要走 adoptInOrder 而不是 addChild：后者把牌追加到末尾，这张牌就永远压在整排之上了。
    const local = this.options.toFanLocal(card.x, card.y)
    fan.adoptInOrder(card)
    card.position.set(local.x, local.y)
    fan.returnToFan(card)
  }
}
