/**
 * 构筑页那几段「玩家做了什么，当场演一下」的补间：抬起、飞进格子、飞回卡池、加不进去摇头。
 *
 * 从 input.ts 里拎出来的一层，理由和 director/cuePlayers 那边一样：
 * **判定和演出分开**。输入层只回答「这一下是加牌还是移除、落在第几格」，
 * 演成什么样全在这个文件里，改节奏不用碰状态机。时长全部 import `timings.ts`。
 *
 * 每一段都收一个 `onDone`，由调用方在里面改状态、还卡、重排画面：
 * 补间跑完之前状态**不动**（牌还在半空，格子里就不该已经多出一份），
 * 这也是黑客松那边「加入成功之后不再播归位」那句注释说的同一件事。
 */

import type { CardSprite } from '../../components/CardSprite'
import { DRAG_FOLLOW_DUR, DRAG_POSE_DUR, DRAG_SCALE } from '../../interaction/dragRules'
import type { Animator } from '../../runtime/animator'
import {
  DROP_BACK_DELAY,
  INSERT_DUR,
  INSERT_EASE,
  REFUSE_SHAKE_DEG,
  REFUSE_SHAKE_DUR,
  RETURN_DUR,
  RETURN_FADE_PORTION,
  RETURN_FLIGHT_DUR,
} from './timings'

/** 一个落点：位置加到那儿时卡该多大。 */
export interface FlightPoint {
  x: number
  y: number
  scale: number
}

/**
 * 抓起来：转正、放大到 `DRAG_SCALE`、亮出卡下那团影子。
 *
 * 放大是从**原位那一档**缩放起跳的（卡池那张本来就画得大，格子里那张小一半），
 * 所以起点由调用方给，不去读卡此刻的 scale——它可能正停在上一段补间的中途。
 */
export function liftCard(
  animator: Animator,
  card: CardSprite,
  fromScale: number,
  toScale: number,
): void {
  card.setLifted(true)
  card.scale.set(fromScale)
  animator.tween(card.scale, {
    x: toScale * DRAG_SCALE,
    y: toScale * DRAG_SCALE,
    duration: DRAG_POSE_DUR,
    ease: 'power2.out',
    overwrite: 'auto',
  })
}

/**
 * 跟手：补一段短补间而不是直接写坐标。
 *
 * 0.18 秒的迟滞就是「牌被拽着走」那点手感（同对局的拖拽，常量共用 dragRules）。
 * `overwrite: 'auto'` 让后一次跟随顶掉前一次，指针连着动时不会攒出一串补间。
 */
export function followCard(animator: Animator, card: CardSprite, x: number, y: number): void {
  animator.tween(card.position, {
    x,
    y,
    duration: DRAG_FOLLOW_DUR,
    ease: 'power2.out',
    overwrite: 'auto',
  })
}

/**
 * 松手之后飞向某个落点。
 *
 * 位置和缩放两条并排跑，跑完再多等 `DROP_BACK_DELAY` 才交还调用方：
 * 正好卡在补间末帧交还会看到一次跳动，这 0.06 秒是留给收尾的余量（抄黑客松的同名常量）。
 * 走时间线而不是三条各自的补间，是因为「等一会儿再收尾」要挂在整段的末尾上，
 * 而时间线在 `Animator` 那边只记一笔账（见它的文件头）。
 */
function flyTo(
  animator: Animator,
  card: CardSprite,
  point: FlightPoint,
  duration: number,
  ease: string,
  onDone: () => void,
): ReturnType<Animator['timeline']> {
  const timeline = animator.timeline()
  timeline.to(card.position, { x: point.x, y: point.y, duration, ease, overwrite: 'auto' }, 0)
  timeline.to(card.scale, { x: point.scale, y: point.scale, duration, ease, overwrite: 'auto' }, 0)
  timeline.call(
    () => {
      card.setLifted(false)
      onDone()
    },
    undefined,
    duration + DROP_BACK_DELAY,
  )
  return timeline
}

/**
 * 新加的那一份飞进牌组让出来的那一格。
 *
 * 状态在 `onDone` 里才改：飞到一半时格子里就多出一份的话，屏幕上会有两张一样的牌，
 * 一张停在格子里、一张还在半空。
 */
export function flyIntoSlot(
  animator: Animator,
  card: CardSprite,
  point: FlightPoint,
  onDone: () => void,
): void {
  flyTo(animator, card, point, INSERT_DUR, INSERT_EASE, onDone)
}

/**
 * 从牌组送回卡池那一程。末尾那 35% 里淡掉：落点那张牌此刻可能根本不在视野里
 *（卡池滚在别处），不淡就是凭空消失。
 */
export function flyBackToPool(
  animator: Animator,
  card: CardSprite,
  point: FlightPoint,
  onDone: () => void,
): void {
  const timeline = flyTo(animator, card, point, RETURN_FLIGHT_DUR, INSERT_EASE, onDone)
  timeline.to(
    card,
    {
      alpha: 0,
      duration: RETURN_FLIGHT_DUR * RETURN_FADE_PORTION,
      ease: 'none',
      overwrite: 'auto',
    },
    RETURN_FLIGHT_DUR * (1 - RETURN_FADE_PORTION),
  )
}

/** 拖拽被取消（落在谁的地盘都不算），把卡送回原来那一格。 */
export function flyHome(
  animator: Animator,
  card: CardSprite,
  point: FlightPoint,
  onDone: () => void,
): void {
  flyTo(animator, card, point, RETURN_DUR, 'power2.out', onDone)
}

/**
 * 加不进去：摇个头。
 *
 * 黑客松是在倾斜层的 z 轴上摇（那一层只写 rotationX / rotationY，z 轴空着），
 * 这一版直接摇卡本身——卡的原点在**底边中点**，所以摇起来是吊着晃而不是原地转，
 * 幅度比绕中心转看着更明显，五个关键帧的角度照抄不用改。
 */
export function shakeCard(animator: Animator, card: CardSprite): void {
  animator.tween(card, {
    keyframes: REFUSE_SHAKE_DEG.map((deg) => ({ rotation: (deg * Math.PI) / 180 })),
    duration: REFUSE_SHAKE_DUR,
    ease: 'power2.out',
    overwrite: 'auto',
  })
}
