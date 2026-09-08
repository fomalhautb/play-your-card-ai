/**
 * 卡面「跟着指针倾斜 + 一小块反光」。节奏和物理模型抄自旧客户端 `src/ui/cardTilt.ts`。
 *
 * 模型是：指针像手指一样把卡按下去，被按下的那一角的对角就翘向观察者、正对光源、反光最亮，
 * 所以高光落在指针的**镜像位置**而不是指针底下（取镜像那一步在 fx/cardGlare.ts 里做）。
 * 改一边就得改另一边。
 *
 * 和旧版有一处不一样，是被 Pixi 逼的：平滑不走 GSAP。
 * 旧版用 quickTo，那条路建的补间不在我们的活动补间账上，帧循环（3.6）会以为没事在做而停掉。
 * 这里改成每帧朝目标值收一段，收敛没收敛由 advance 自己报，账目和帧循环是同一本。
 * 时长换算成时间常数就是除以三（指数收敛跑三个时间常数约到 95%）。
 *
 * 倾斜本身是真透视，不是压扁错切：角度交给 CardSprite，由它换算成各层的四个角
 * （见 cardProjection.ts）。
 */

import { HOVER_TILT_DEG } from '../layout/handLayout'
import type { CardSprite } from './CardSprite'

/** 倾斜跟随指针的时间常数（秒），对应旧版 FOLLOW_DUR = 0.35s。太短会跟得发飘，太长会拖成"甩尾"。 */
const FOLLOW_TAU = 0.35 / 3
/** 收手时归零的时间常数，对应旧版 RESET_DUR = 0.15s，比跟随更干脆。 */
const RESET_TAU = 0.15 / 3
/** 高光淡入淡出的时间常数，对应旧版 GLARE_FADE = 0.2s。 */
const GLARE_TAU = 0.2 / 3

/**
 * 高光最亮时整层的不透明度。
 *
 * 旧版这一层淡入到 1（亮度全由渐变自己的色标定，最亮 40%），因为它混合用的是 soft-light。
 * 我们没有 soft-light 可用（Pixi v8 里那类混合是拿 Filter 实现的，3.1 不许离屏），
 * 换成了原生的 screen——screen 等于"朝白色插值"，提得比 soft-light 狠一截，
 * 照旧版的亮度会白成一块斑、盖住卡面上的字。压到 0.55 之后峰值约等于把底色提亮两成，
 * 接近覆膜那种哑光反光。
 */
const GLARE_ALPHA = 0.55
/**
 * 收敛判据：残差小到这个程度就直接落到目标值上，这一路就算停了，帧循环可以歇了（3.6）。
 *
 * 角度这一档按「卡上最远的那个点还挪不挪得动一个像素」定：卡心到角约 135
 * （√(75² + 112.5²)），转 0.05° 是 135 × 0.05 × π/180 ≈ 0.12 个卡单位，
 * hover 放大约 1.9 倍、渲染倍率封顶 1.5（3.3），折合 0.33 个设备像素——屏幕上表现不出来。
 *
 * 为什么不能取得更小：指数收敛的尾巴很长。从 6° 收到 0.0005° 要跑九个多时间常数，
 * 也就是一秒多；那一秒里画面一动不动，帧循环却一直在转。手机上那是白烧电，
 * 跑批里是白烧一整段剧本的时间（实测占 play10 的三成帧）。
 */
const SETTLED_ANGLE_DEG = 0.05
/** 高光那一路的收敛判据：1/255 是 8 位颜色通道能表示的最小一档，比它小的差别写不进去。 */
const SETTLED_ALPHA = 1 / 255
/** 反光暗到这个程度就当没有，直接从绘制队列里摘掉。1/255 都不到，肉眼看不出差别。 */
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

  /** 目标值和当前值：绕 Y、绕 X 的角度（度），以及高光的亮度。 */
  private targetY = 0
  private targetX = 0
  private currentY = 0
  private currentX = 0
  private targetGlare = 0
  private currentGlare = 0
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
    /*
     * 光心不做平滑，直接跟手：它本来就该和指针一样跟手（只是取的是镜像点），
     * 插值反而会糊。也因此只在指针真的动了的时候写一次 uniform，不放进逐帧的 advance 里。
     */
    this.card.glare?.setPointer(rx, ry)
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
    this.currentX = approach(this.currentX, this.targetX, dt, tau, SETTLED_ANGLE_DEG)
    this.currentY = approach(this.currentY, this.targetY, dt, tau, SETTLED_ANGLE_DEG)
    this.currentGlare = approach(this.currentGlare, this.targetGlare, dt, GLARE_TAU, SETTLED_ALPHA)

    this.card.setTilt(this.currentX, this.currentY)
    if (this.card.glare !== null) {
      this.card.glare.alpha = this.currentGlare
      // 暗到看不见就整个藏起来：它带自己的着色器，留在绘制队列里就是一次白挨的绘制调用（3.9）。
      this.card.glare.visible = this.currentGlare > GLARE_EPS
    }

    // approach 到了判据以内就直接落在目标上，所以"还在动"就是"还没等于目标"，不用再留容差。
    return (
      this.currentX !== this.targetX ||
      this.currentY !== this.targetY ||
      this.currentGlare !== this.targetGlare
    )
  }

  /** 硬归零：抓起牌开始拖拽时用——指针已经被捕获，等不到"指针离开"自己来收手。 */
  reset(): void {
    this.release()
    this.currentX = 0
    this.currentY = 0
    this.currentGlare = 0
    this.card.setTilt(0, 0)
    if (this.card.glare !== null) {
      this.card.glare.alpha = 0
      this.card.glare.visible = false
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 朝目标收敛一步。dt 是这一帧的秒数，tau 是时间常数（越小收得越快）。
 *
 * 差到 eps 以内就直接落到目标上，不再慢慢挪：指数收敛永远到不了终点，不落一下的话
 * 卡会停在一个差零点几像素的角度上不动，"到底停没停"还得调用方再判一次。
 * 落了之后"还在动"就等价于"还不等于目标"，一个等号就够。
 */
function approach(current: number, target: number, dt: number, tau: number, eps: number): number {
  const next = current + (target - current) * (1 - Math.exp(-dt / tau))
  return Math.abs(target - next) <= eps ? target : next
}
