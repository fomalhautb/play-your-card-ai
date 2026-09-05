/**
 * 卡面「跟着指针倾斜 + 一小块反光」。节奏和物理模型抄自旧客户端 `src/ui/cardTilt.ts`。
 *
 * 模型是：指针像手指一样把卡按下去，被按下的那一角的对角就翘向观察者、正对光源、反光最亮，
 * 所以高光落在指针的**镜像位置**而不是指针底下。改一边就得改另一边。
 *
 * 两处和旧版不一样，都是被 Pixi 的二维性质逼的：
 * 1. 没有 rotationX / rotationY。用「压扁 + 错切」凑：绕 Y 轴转 θ 就横向压到 cos θ、
 *    再按 sin θ 竖着错一点。仿射变换做不出真正的透视梯形，但十度以内看着就是在倾斜。
 * 2. 平滑不走 GSAP。旧版用 quickTo，那条路建的补间不在我们的活动补间账上，
 *    帧循环（3.6）会以为没事在做而停掉。这里改成每帧朝目标值收一段，
 *    收敛没收敛由 advance 自己报，账目和帧循环是同一本。
 */

import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import { HOVER_TILT_DEG } from '../layout/handLayout'
import type { CardSprite } from './CardSprite'

/** 倾斜跟随指针的时间常数（秒）。太短会跟得发飘，太长会拖成"甩尾"。 */
const FOLLOW_TAU = 0.35 / 3
/** 收手时归零的时间常数，比跟随更干脆。 */
const RESET_TAU = 0.15 / 3
/** 高光淡入淡出的时间常数。 */
const GLARE_TAU = 0.2 / 3

/** 高光最亮时的不透明度。再高就成了一块白斑，盖住卡面上的字。 */
const GLARE_ALPHA = 0.34
/** 错切幅度系数：十度倾角配 0.25 时错切约 2.5°，看得出在动又不至于变形。 */
const SKEW_K = 0.25
/** 收敛判据：三个通道都进到这个范围内就算停了，帧循环可以歇了。 */
const SETTLED_EPS = 0.0005
/** 反光暗到这个程度就当没有，直接从绘制批里摘掉。1/255 都不到，肉眼看不出差别。 */
const GLARE_EPS = 0.002

/**
 * 一张卡的倾斜跟随。指针在卡面上的相对位置由调用方算好传进来（0~1，超出范围会被夹住）。
 *
 * 不自己监听指针事件：命中判定、坐标换算、"现在该不该跟随"都只有场景知道
 * （扇形里没放大的小卡本身就是斜的，再叠一层就是一团乱，旧版同样只给放大的那张开）。
 */
export class CardTilt {
  private readonly card: CardSprite
  private readonly enabled: boolean

  /** 目标值和当前值：绕 Y、绕 X 的角度（度），以及高光的位置和亮度。 */
  private targetY = 0
  private targetX = 0
  private currentY = 0
  private currentX = 0
  private targetGlare = 0
  private currentGlare = 0
  private glareX = 0
  private glareY = 0
  /** 收手时用更快的时间常数，和旧版的 RESET_DUR 对应。 */
  private releasing = true

  constructor(card: CardSprite, enabled: boolean) {
    this.card = card
    this.enabled = enabled
  }

  /** 指针压在卡面上的相对位置（左上角是 0,0，右下角是 1,1）。 */
  setPointer(ratioX: number, ratioY: number): void {
    if (!this.enabled) return
    const rx = clamp01(ratioX)
    const ry = clamp01(ratioY)
    this.releasing = false
    // 指针在哪边，哪边就往屏幕里陷下去，像用手指把卡牌那一角按住往下按。
    // 符号：正的绕 X 让上沿往后倒、正的绕 Y 让右沿往后倒，所以指针在下半部配负的绕 X。
    this.targetX = -(ry - 0.5) * 2 * HOVER_TILT_DEG
    this.targetY = (rx - 0.5) * 2 * HOVER_TILT_DEG
    this.targetGlare = GLARE_ALPHA
    // 高光放在指针的镜像位置（对角），不是指针底下，理由见文件头的物理模型。
    this.glareX = (0.5 - rx) * CARD_WIDTH
    this.glareY = -CARD_HEIGHT + (1 - ry) * CARD_HEIGHT
  }

  /** 收手：倾斜归零、高光淡出。 */
  release(): void {
    this.releasing = true
    this.targetX = 0
    this.targetY = 0
    this.targetGlare = 0
  }

  /**
   * 朝目标值收一帧，返回还在不在动。
   *
   * 用「按时间常数指数收敛」而不是固定步长：帧率变了收敛速度不跟着变，
   * 手动步进和真实时钟下的观感才是同一套。
   */
  advance(deltaMs: number): boolean {
    if (!this.enabled) return false
    const dt = deltaMs / 1000
    const tau = this.releasing ? RESET_TAU : FOLLOW_TAU
    this.currentX = approach(this.currentX, this.targetX, dt, tau)
    this.currentY = approach(this.currentY, this.targetY, dt, tau)
    this.currentGlare = approach(this.currentGlare, this.targetGlare, dt, GLARE_TAU)

    const radX = (this.currentX * Math.PI) / 180
    const radY = (this.currentY * Math.PI) / 180
    const layer = this.card.tiltLayer
    layer.scale.set(Math.cos(radY), Math.cos(radX))
    layer.skew.set(-Math.sin(radX) * SKEW_K, Math.sin(radY) * SKEW_K)

    this.card.glare.alpha = this.currentGlare
    // 暗到看不见就整个藏起来：它是叠加混合的，留在绘制批里等于白挨两次混合模式切换（3.9）。
    this.card.glare.visible = this.currentGlare > GLARE_EPS
    if (this.card.glare.visible) this.card.glare.position.set(this.glareX, this.glareY)

    return (
      Math.abs(this.currentX - this.targetX) > SETTLED_EPS ||
      Math.abs(this.currentY - this.targetY) > SETTLED_EPS ||
      Math.abs(this.currentGlare - this.targetGlare) > SETTLED_EPS
    )
  }

  /** 硬归零：抓起牌开始拖拽时用——指针已经被捕获，等不到"指针离开"自己来收手。 */
  reset(): void {
    this.release()
    this.currentX = 0
    this.currentY = 0
    this.currentGlare = 0
    this.card.tiltLayer.scale.set(1)
    this.card.tiltLayer.skew.set(0)
    this.card.glare.alpha = 0
    this.card.glare.visible = false
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 朝目标收敛一步。dt 是这一帧的秒数，tau 是时间常数（越小收得越快）。 */
function approach(current: number, target: number, dt: number, tau: number): number {
  const k = 1 - Math.exp(-dt / tau)
  return current + (target - current) * k
}
