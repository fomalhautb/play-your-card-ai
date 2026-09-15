/**
 * 开局定先手的抛硬币过场：一块方块翻转，底下一行字。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：金色币面和外圈两张烤纹理删了，
 * 正反两面各换成一块印着「正」「反」的方块。时长、转的圈数、回弹一个数都没动。
 *
 * 节奏抄旧版 `MatchStage.tsx:1436-1486` 的那条时间线：
 * 层淡入 0.25 与「币弹出 0.5」「转 4 圈 1.6」同时起跑（前两段被最长的转动盖住），
 * 转完回弹一下（0.12 来回各一次），停 `COIN_HOLD`，整层淡出 0.4。
 * 总长直接 import `COIN_TOSS_TOTAL_MS`，各段占的比例在下面的 PHASE 里，
 * 改 timings 那一条时四段会一起等比例变。
 *
 * 「转」是绕 Y 轴的三维翻转，画布上用 `scale.x = |cos θ|` 模拟：
 * 转到 90° 时宽度为零、正反面在那一刻硬切（旧版 DOM 那边也是这么切的，理由见黑客松版的
 * flipCard.ts——`backface-visibility` 在补间途中判断不可靠）。
 * 不走 `cardProjection` 那套真透视：那是为**卡牌**写的（近大远小要靠四边形网格），
 * 而硬币是个正圆，转起来近大远小几乎看不出来，为它多建一份网格不划算。
 *
 * 落在正面（0°）还是背面（180°）就是「先手是我」和「先手是对方」的区别，
 * 和旧版 `landing = 4×360 + (先手是我 ? 0 : 180)` 一致。
 *
 * 这一层是**全屏半透明**的，同屏最多三层那条（3.2）由场景保证：
 * 抛硬币、抵消层、展示层、结算层在编排层里本来就是互斥的（旧版那四道闸门）。
 */

import { Container, Graphics } from 'pixi.js'
import { COIN_TOSS_TOTAL_MS } from '../director/timings'
import { VEIL } from '../fx/colors'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'

/** 币画多大，以及底下那行字那一格多大。组件私有，理由见 design 的 README。 */
const COIN_SIZE = 240
const CAPTION = { width: 260, height: 40 } as const
/** 币和底下那行字之间留多宽。抄旧样式 `.coin-toss` 的 `gap: 26px`。 */
const CAPTION_GAP = 26
/** 转几圈。抄旧版的 `COIN_SPINS`。 */
const SPINS = 4

/**
 * 四段各占总时长的多少。旧版四个数是 1.6（转）/ 0.24（回弹来回）/ 1.3（停）/ 0.4（淡出），
 * 加起来 3.54，正是 `COIN_TOSS_TOTAL_MS`。这里按同样的比例拆回去。
 */
const PHASE = { spin: 1.6 / 3.54, bounce: 0.24 / 3.54, hold: 1.3 / 3.54, out: 0.4 / 3.54 } as const
/** 层淡入和币弹出各多久（占总长的比例）。两段都排在位置 0，被转动盖住，不进总长。 */
const VEIL_IN = 0.25 / 3.54
const POP_IN = 0.5 / 3.54
/** 落定回弹涨到多大。抄旧版的 `scale: 1.06`。 */
const BOUNCE_SCALE = 1.06

export type CoinTossDeps = BoxDeps & {
  animator: Animator
}

export class CoinToss extends Container {
  private readonly deps: CoinTossDeps
  private readonly veil = new Graphics()
  /** 币的外层：只管弹出和回弹的缩放。 */
  private readonly coin = new Container()
  /** 翻面层：只管 `scale.x` 那一半的模拟翻转，两件事分开写才不会互相覆盖。 */
  private readonly flip = new Container()
  private readonly faces: { front: Box; back: Box }
  private readonly caption: Box
  /** 翻转角度的代理。补间只改这个普通对象，每帧写进显示对象的只有一个 scale（3.10）。 */
  private readonly spin = { angle: 0 }

  constructor(deps: CoinTossDeps) {
    super()
    this.deps = deps
    this.label = 'coin-toss'
    // 过场期间玩家什么都不能做，整层吃掉指针事件（旧版这几层也都是这么干的）。
    this.eventMode = 'static'
    this.faces = { front: this.buildFace('正', deps), back: this.buildFace('反', deps) }
    this.caption = new Box(
      { width: CAPTION.width, height: CAPTION.height, label: '抛硬币定先手' },
      deps,
    )
    this.flip.addChild(this.faces.front, this.faces.back)
    this.coin.addChild(this.flip)
    this.addChild(this.veil, this.coin, this.caption)
    this.visible = false
    this.alpha = 0
  }

  /** 遮罩要铺满整个视口，所以尺寸由调用方给。 */
  resize(width: number, height: number): void {
    this.veil.clear().rect(0, 0, width, height).fill({ color: VEIL.color, alpha: VEIL.alpha })
    const centerY = height / 2 - CAPTION_GAP / 2
    this.coin.position.set(width / 2, centerY)
    this.caption.position.set((width - CAPTION.width) / 2, centerY + COIN_SIZE / 2 + CAPTION_GAP)
  }

  /**
   * 播一遍。`mineFirst` 决定硬币停在正面还是背面。
   * 返回整段时长（毫秒），和 `coin-toss` cue 的 `durationMs` 一致。
   */
  play(mineFirst: boolean): number {
    const total = COIN_TOSS_TOTAL_MS / 1000
    const landing = SPINS * 360 + (mineFirst ? 0 : 180)
    this.visible = true
    this.spin.angle = 0
    this.applySpin()
    this.coin.scale.set(0.4)
    this.coin.alpha = 0

    const timeline = this.deps.animator.timeline({
      onComplete: () => {
        this.visible = false
        this.alpha = 0
      },
    })
    timeline.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration: total * VEIL_IN, ease: 'power2.out' },
      0,
    )
    timeline.to(this.coin, { alpha: 1, duration: total * POP_IN, ease: 'power2.out' }, 0)
    timeline.to(this.coin.scale, { x: 1, y: 1, duration: total * POP_IN, ease: 'back.out(1.8)' }, 0)
    timeline.to(
      this.spin,
      {
        angle: landing,
        duration: total * PHASE.spin,
        ease: 'power3.out',
        onUpdate: () => this.applySpin(),
      },
      0,
    )
    // 落定那一下的回弹，让"停住"这件事有个交代，不然转完就干等着。
    timeline.to(this.coin.scale, {
      x: BOUNCE_SCALE,
      y: BOUNCE_SCALE,
      duration: (total * PHASE.bounce) / 2,
      yoyo: true,
      repeat: 1,
      ease: 'power2.out',
    })
    timeline.to(
      this,
      { alpha: 0, duration: total * PHASE.out, ease: 'power2.in' },
      `+=${total * PHASE.hold}`,
    )
    return COIN_TOSS_TOTAL_MS
  }

  /** 当场收掉（对局中断时的 `clear-overlays`）。 */
  clear(): void {
    this.deps.animator.killTweensOf(this.spin)
    this.deps.animator.killTweensOf(this)
    this.deps.animator.killTweensOf(this.coin)
    this.deps.animator.killTweensOf(this.coin.scale)
    this.visible = false
    this.alpha = 0
  }

  /**
   * 把当前角度写成横向压扁，并决定这一帧露的是哪一面。
   *
   * 压到 0 那一刻两面都是零宽，切换看不见——这就是"硬切"能成立的原因。
   * `Math.abs(Math.cos)` 之外还要给一个下限，否则 scale 恰好为 0 时 Pixi 会把整个变换
   * 退化掉，转过那一帧会闪一下。
   */
  private applySpin(): void {
    const radians = (this.spin.angle * Math.PI) / 180
    this.flip.scale.x = Math.max(0.001, Math.abs(Math.cos(radians)))
    const normalized = ((this.spin.angle % 360) + 360) % 360
    const showBack = normalized > 90 && normalized < 270
    this.faces.front.visible = !showBack
    this.faces.back.visible = showBack
  }

  /** 一面币：一块印着「正」或「反」的方块。原点挪到正中，翻转和缩放才是绕币心做的。 */
  private buildFace(text: string, deps: CoinTossDeps): Box {
    const face = new Box({ width: COIN_SIZE, height: COIN_SIZE, label: text, size: 'title' }, deps)
    face.position.set(-COIN_SIZE / 2, -COIN_SIZE / 2)
    return face
  }
}
