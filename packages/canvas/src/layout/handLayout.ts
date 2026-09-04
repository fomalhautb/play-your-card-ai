/**
 * 手牌扇形的 hover 抬起、邻牌让位和各段动画节奏。
 * 数值和公式抄自旧客户端 `src/ui/HandFan.tsx`，实现改成不依赖 DOM 的纯函数。
 *
 * 和 fanMath.ts 的分界：那边是"没人碰的时候一排牌摆在哪"，这边是"指针压上来之后怎么让"。
 */

import type { FanGeometry } from './fanMath'
import { CARD_WIDTH, fanTransform, SPREAD_DEG, tiltHalfExtent } from './fanMath'

/**
 * hover 时卡底仍然留在视口下方 6px。
 *
 * 这 6px 是防抖动的安全余量：back 缓动会冲过目标位再弹回来，
 * 冲过头的那一瞬间卡底会比目标位再高几个像素，留出余量才能保证卡底始终在视口外。
 */
export const HOVER_BOTTOM = 6

/**
 * 放大倍数的下限，由扇形最大倾角和卡面尺寸算出来，不是拍脑袋定的。
 *
 * 放大后的卡半宽必须够到倾斜卡牌最远那个角的横向距离（tiltHalfExtent），
 * 否则扇形两端那张牌的外上角会露在放大后的卡外面（40° 时露出约 11px），
 * 指针停在那一小块上就会「放大 → 指针掉到卡外 → 缩回 → 又被 hover 到」无限循环。
 * 写成公式而不是常数，是为了改 SPREAD_DEG 时不用手工重新对表。
 */
export const MIN_HOVER_SCALE = tiltHalfExtent(SPREAD_DEG / 2) / (CARD_WIDTH / 2)

/** hover 放大的倍数：想要 1.75，但不能低于上面那条几何下限（40° 时下限约 1.9）。 */
export const HOVER_SCALE = Math.max(1.75, MIN_HOVER_SCALE)

/**
 * 邻牌让位之后，和放大的那张牌之间还要留出的横向余量。
 * 纯观感：卡边贴着卡边擦过去像是"差点撞上"，留出几个像素才看得出是主动让开的。
 */
export const NEIGHBOR_CLEARANCE = 8

/** hover 进出的时长，要比重排更干脆。 */
export const HOVER_DUR = 0.28
/** hover 抬起用的缓动：冲过目标位一点再弹回来，抬牌才有"弹出来"的手感。 */
export const HOVER_EASE = 'back.out(1.4)'
/** 重排（含落回扇形）用的缓动。 */
export const LAYOUT_EASE = 'power3.out'

/**
 * 拿不到牌库位置时，新牌先在基准位下方沉这么多再滑上来。
 * 卡高 225，沉 140 之后露在视口里的只剩顶上一小条，看着就像刚从屏幕外被抽上来。
 */
export const ENTER_SINK = 140

/**
 * 开局那几张牌依次起飞的间隔（秒）。
 * 太密看着像一把甩出去，太疏又要干等：0.12 × 5 张 = 0.6 秒，正好是"一张张发"。
 */
export const DEAL_STAGGER = 0.12

/** 放大后的卡跟着指针倾斜的最大角度（度）。只给放大的那张牌用。 */
export const HOVER_TILT_DEG = 10

/** 一张牌在扇形里该摆成什么样。scale 是相对卡面基准尺寸（150×225）的倍数。 */
export interface SlotPose {
  x: number
  y: number
  /** 单位是度，写进 Pixi 前要换算成弧度。 */
  rotation: number
  scale: number
}

/**
 * 算出 hover 某张牌时，其余每张牌要横向让开多少（下标和排布顺序一致，正数向右）。
 *
 * 让位幅度是"刚好挪出放大卡的轮廓"算出来的，不是按距离衰减的固定值：
 * 放大卡以底边中点为轴放大，横向半宽就是 CARD_WIDTH / 2 × HOVER_SCALE；
 * 邻牌是斜的，朝放大卡那一侧伸得最远的是**底边**那个角，伸出 (CARD_WIDTH / 2) × cos(倾角)
 * ——上面那个角被旋转甩向了扇形外侧，够不到中间来。两者加上余量不重叠，就是下面的式子。
 *
 * 关键是从 hover 卡往外一张张推，每张牌至少要让开和内侧那张一样多（那两句 max / min）：
 * 只按各自的需求算的话，被推开的内侧牌会直接怼到外侧牌身上叠成一坨。
 * 这样整侧牌是"被推着走"的，彼此间距不变，越靠外让得越少，够远的牌一动不动。
 */
export function neighborPushes(
  hoverIndex: number,
  count: number,
  areaWidth: number,
  geometry: FanGeometry,
): number[] {
  const pushes = new Array<number>(count).fill(0)
  if (hoverIndex < 0 || hoverIndex >= count) return pushes

  const hovered = fanTransform(hoverIndex, count, areaWidth, geometry)
  const half = (CARD_WIDTH / 2) * HOVER_SCALE + NEIGHBOR_CLEARANCE
  /** 一张牌朝扇形中间伸出多远：底边那个角，随倾角变小。 */
  const reachOf = (index: number) =>
    (CARD_WIDTH / 2) *
    Math.cos((fanTransform(index, count, areaWidth, geometry).rotation * Math.PI) / 180)

  let carry = 0
  for (let i = hoverIndex - 1; i >= 0; i -= 1) {
    const base = fanTransform(i, count, areaWidth, geometry)
    carry = Math.min(carry, hovered.x - half - reachOf(i) - base.x)
    pushes[i] = carry
  }
  carry = 0
  for (let i = hoverIndex + 1; i < count; i += 1) {
    const base = fanTransform(i, count, areaWidth, geometry)
    carry = Math.max(carry, hovered.x + half + reachOf(i) - base.x)
    pushes[i] = carry
  }
  return pushes
}

/**
 * 一排牌各自该摆成什么姿态：被 hover 的那张抬起放大转正，其余的让开位置照常斜着。
 *
 * hoverIndex 传 −1 就是"没人被 hover"，整排回到基准位。
 * 抬起的那张 y 取 HOVER_BOTTOM 而不是基准位：它要竖直抬到贴着视口下沿，
 * 和自己原来沉了多少无关，这样几张牌抬起来的高度才是一样的。
 */
export function handPoses(
  count: number,
  areaWidth: number,
  geometry: FanGeometry,
  hoverIndex: number,
): SlotPose[] {
  const pushes = neighborPushes(hoverIndex, count, areaWidth, geometry)
  const poses: SlotPose[] = []
  for (let i = 0; i < count; i += 1) {
    const base = fanTransform(i, count, areaWidth, geometry)
    if (i === hoverIndex) {
      poses.push({ x: base.x, y: HOVER_BOTTOM, rotation: 0, scale: HOVER_SCALE })
      continue
    }
    poses.push({ x: base.x + (pushes[i] ?? 0), y: base.y, rotation: base.rotation, scale: 1 })
  }
  return poses
}
