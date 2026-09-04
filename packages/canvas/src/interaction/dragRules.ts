/**
 * 拖拽出牌的判定规则，全是纯函数：只吃数字，不碰 Pixi、不碰 DOM，也不记状态。
 * 数值抄自旧客户端 `src/ui/useCardDrag.ts`，判定逻辑抄自它的 handlePointerMove / handlePointerUp。
 *
 * 抽成纯函数是为了能不开浏览器就测（见 test/dragRules.test.ts）——
 * 「走多远算起拖」「松手算不算打出」这两条是出牌手感的全部，也是最容易改坏的地方。
 * 有状态的那一半（指针捕获、跟随补间、姿态切换）在 components/HandFan.ts 里。
 */

/**
 * 按下之后指针要走过这么多像素才算拖拽，没走到就只是一次点击。
 * 4px 足够吸收按鼠标时手抖带出来的一两个像素，又不至于让人觉得"拖了半天才动"。
 */
export const DRAG_THRESHOLD = 4

/**
 * 触屏起拖要走过的**横向**位移，比鼠标那 4px 大得多。
 *
 * 手指落点几乎必然压在某张牌上，而 4px 在触屏上根本算不上一次动作——按下去那一瞬
 * 接触点的漂移就有这么多。滚一屏卡因此每次都会先把牌抓起来，等浏览器认定这是滚动
 * 再补一发取消把牌扔回去，画面上就是牌乱跳。
 */
export const TOUCH_DRAG_THRESHOLD = 14

/**
 * 触屏方向锁：竖向位移一旦到这个数，这次按下就判成"玩家在滚列表"，整个作废。
 * 比 TOUCH_DRAG_THRESHOLD 小是故意的——两条线之间的那段里竖向先到就认滚动，
 * 让滚动赢在前面。误起拖（牌跳一下）比误判成滚动（再横划一次）难受得多。
 */
export const TOUCH_SCROLL_SLOP = 8

/**
 * 横向要压过竖向这么多倍才算横滑。
 * 只看"横向够不够长"挡不住斜着划：45° 的线横竖分量一样大，横向照样能过阈值。
 * 1.2 留了一点容差——手指划的横线本来就不可能是水平的。
 */
export const TOUCH_AXIS_RATIO = 1.2

/** 触屏按住不动多久算"我要拖这张牌"（毫秒）。方向锁只放行横滑，长按是第二条路。 */
export const TOUCH_HOLD_DELAY = 300
/** 长按期间手指允许漂移的距离；超过就不算按住不动。也用来判"这一下算不算点击"。 */
export const TOUCH_HOLD_TOLERANCE = 8

/** 拖起来之后卡牌放大到的倍数。 */
export const DRAG_SCALE = 1.1
/** 从原来的姿态切到拖拽姿态（转正 + 放大到 DRAG_SCALE）的时长。 */
export const DRAG_POSE_DUR = 0.25
/** 跟随指针的补间时长。短到跟手，又留着一点"牌被拽着走"的迟滞。 */
export const DRAG_FOLLOW_DUR = 0.18

/** 一次按下走到现在的判定结果。 */
export type DragGesture =
  /** 还没走够，继续等。 */
  | 'idle'
  /** 起拖。 */
  | 'drag'
  /** 判成滚动，这次按下整个作废（只有开了滚动优先的触屏会出现）。 */
  | 'scroll'

export interface DragBeginInput {
  /** 相对按下点的位移。 */
  dx: number
  dy: number
  /**
   * 是否走"滚动优先"那套判定：牌坐在竖向滚动区里、而且不是鼠标按的。
   * 手牌扇形底下没有滚动区，传 false；卡组页那种铺满的卡池才传 true。
   */
  scrollGuard: boolean
}

/**
 * 走过的这点位移够不够起拖。
 *
 * 鼠标（以及没开滚动优先时）是一条：任意方向过 DRAG_THRESHOLD。
 * 触屏在滚动区里按方向分：竖向先跑出去就判成滚动，把这次按下整个收掉；
 * 横向够长、而且压过竖向 TOUCH_AXIS_RATIO 倍才算起拖。
 */
export function dragGestureOf({ dx, dy, scrollGuard }: DragBeginInput): DragGesture {
  if (!scrollGuard) return Math.hypot(dx, dy) >= DRAG_THRESHOLD ? 'drag' : 'idle'
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ay >= TOUCH_SCROLL_SLOP && ay * TOUCH_AXIS_RATIO > ax) return 'scroll'
  if (ax >= TOUCH_DRAG_THRESHOLD && ax > ay * TOUCH_AXIS_RATIO) return 'drag'
  return 'idle'
}

/** 一块矩形区域，左上角加宽高，坐标系由调用方定（这里只做包含判断）。 */
export interface DropZoneRect {
  x: number
  y: number
  width: number
  height: number
}

/** 指针在不在这块区域里。宽或高为 0 的区域（还没布局出来）一律不成立。 */
export function pointInZone(px: number, py: number, zone: DropZoneRect | null): boolean {
  if (zone === null || zone.width <= 0 || zone.height <= 0) return false
  return px >= zone.x && px <= zone.x + zone.width && py >= zone.y && py <= zone.y + zone.height
}

/** 松手之后这次拖拽的结局。 */
export type DropOutcome =
  /** 打出：指针落在出牌区里。 */
  | 'play'
  /** 回弹：落在别处、或者这一刻根本不许出牌。 */
  | 'return'
  /** 没起拖，只是原地点了一下。牌一动没动，也就谈不上归位。 */
  | 'tap'

export interface DropInput {
  /** 松手时的指针位置，和 zone 用同一套坐标。 */
  pointerX: number
  pointerY: number
  /** 出牌区。null 表示调用方没给（比如手牌被搬到没有战场的页面上用），一切落点都不成立。 */
  zone: DropZoneRect | null
  /** 有没有真的走过阈值起拖。false 就是点了一下。 */
  dragging: boolean
  /** 这一刻允许不允许出牌。拖到一半被关掉时松手一律按取消算。 */
  enabled: boolean
  /** 从按下到松手走了多远，用来判"斜着划了一大段"算不算点击（只有滚动优先时才严格）。 */
  moved: number
  /** 是否走滚动优先那套判定，含义同 DragBeginInput.scrollGuard。 */
  scrollGuard: boolean
}

/**
 * 松手时该怎么办。
 *
 * 判据是**指针**落没落进出牌区，不是卡牌和它相交——这样"卡画得多大、歪多少"
 * 都不影响落点，和炉石一致。
 *
 * 没起拖的那条路要再分一次：滚动优先的触屏上"斜着划了一大段、两条阈值都没过"
 * 不是"点了一下"，不该把牌弹出来，所以手指挪出容差就不算点击。
 */
export function resolveDrop(input: DropInput): DropOutcome {
  if (!input.dragging) {
    const tapped = !input.scrollGuard || input.moved <= TOUCH_HOLD_TOLERANCE
    return input.enabled && tapped ? 'tap' : 'return'
  }
  if (!input.enabled) return 'return'
  return pointInZone(input.pointerX, input.pointerY, input.zone) ? 'play' : 'return'
}
