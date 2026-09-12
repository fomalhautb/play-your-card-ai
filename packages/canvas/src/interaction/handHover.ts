/**
 * 手牌的 hover：指针停上来把那张抬起放大、离开延迟一下再收回，抬着的那张跟着指针倾斜。
 *
 * 从 `handPointer.ts` 拆出来的另一半。分界线是「指针有没有按下去」：
 * 这边管的是**没按下**时的那一档（停留、离开、跟着转），按下之后的阈值、拖拽、
 * 松手判定全在那边。两边只通过「现在还按不按着」这一个条件互相让路——
 * 一按下去 hover 就整个收手（`cancel`），指针被捕获之后各浏览器发不发边界事件并不统一，
 * 与其猜它们的行为，不如在这里挡掉。
 *
 * 抬起的补间归扇形自己（`HandFan.setHover`），倾斜的物理模型归 `CardTilt`，
 * 这个文件只是那两样的调度：谁被抬着、什么时候放手、指针压在卡面的哪个位置。
 */

import type { Container } from 'pixi.js'
import { Point } from 'pixi.js'
import type { CardSprite } from '../components/CardSprite'
import type { CardTilt } from '../components/cardTilt'
import type { HandFan } from '../components/HandFan'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'

/**
 * 指针离开卡牌后延迟这么久才缩回去。
 *
 * 几何上放大后的卡已经盖住了自己原来的位置，但补间途中卡还没长到最大，
 * 卡角附近会短暂空出几个像素。这点延迟让"扫过空档又立刻回来"的指针不会触发一次缩放。
 */
const LEAVE_DELAY_MS = 50

export interface HandHoverOptions {
  /** 舞台。喂倾斜时要把舞台坐标换算到卡自己的坐标系里。 */
  stage: Container
  fan: HandFan
  /** 这张牌的倾斜跟随，没有就是这一档不做倾斜。 */
  tiltFor: (card: CardSprite) => CardTilt | undefined
  /** 抬起来的换成了哪一张（没有就是 null）。 */
  onHover?: (card: CardSprite | null) => void
  /** 叫醒帧循环：收回的倒计时和倾斜的收敛都只在 `advance` 里推进。 */
  wake: () => void
}

export class HandHover {
  private readonly options: HandHoverOptions
  private hovered: CardSprite | null = null
  /** 指针离开之后还剩多少毫秒才真的收回。负数表示没有在倒计时。 */
  private countdown = -1
  private readonly scratch = new Point()

  constructor(options: HandHoverOptions) {
    this.options = options
  }

  /** 现在抬着的是哪一张。 */
  get card(): CardSprite | null {
    return this.hovered
  }

  /** 指针停到某张牌上。 */
  enter(card: CardSprite): void {
    this.countdown = -1
    if (this.hovered === card) return
    if (this.hovered !== null) this.options.tiltFor(this.hovered)?.release()
    this.hovered = card
    this.options.fan.setHover(this.options.fan.laid().indexOf(card))
    this.options.onHover?.(card)
  }

  /** 指针离开某张牌：开始倒计时，到点才真的收回。 */
  leave(card: CardSprite): void {
    if (this.hovered !== card) return
    this.countdown = LEAVE_DELAY_MS
    // 倒计时是在 advance 里减的，不叫醒帧循环就永远减不到零，抬起来的牌收不回去。
    this.options.wake()
  }

  /** 立刻收手，不等倒计时（按下去开始拖、或者整排要冻住时）。 */
  cancel(): void {
    this.countdown = -1
    this.collapse()
  }

  /** 指针在抬着的那张牌上移动：把相对位置喂给倾斜跟随。 */
  point(stageX: number, stageY: number): void {
    const card = this.hovered
    if (card === null) return
    const tilt = this.options.tiltFor(card)
    if (tilt === undefined) return
    this.scratch.set(stageX, stageY)
    // 传进来的已经是舞台坐标，所以要指明「从舞台那套换过去」，不指明 Pixi 会当成视口坐标。
    const local = card.toLocal(this.scratch, this.options.stage, this.scratch)
    // 卡面在自己的坐标里占 x ∈ [−75, 75]、y ∈ [−225, 0]（原点在底边中点）。
    tilt.setPointer(local.x / CARD_WIDTH + 0.5, local.y / CARD_HEIGHT + 1)
    // 倾斜和高光都要等 advance 收敛，抬起的补间早就演完了，这时候帧循环停着，得自己叫醒。
    this.options.wake()
  }

  /** 推进收回的倒计时，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean {
    if (this.countdown < 0) return false
    this.countdown -= deltaMs
    if (this.countdown < 0) {
      this.countdown = -1
      this.collapse()
    }
    return true
  }

  private collapse(): void {
    if (this.hovered === null) return
    this.options.tiltFor(this.hovered)?.release()
    this.hovered = null
    this.options.fan.setHover(-1)
    this.options.onHover?.(null)
  }
}
