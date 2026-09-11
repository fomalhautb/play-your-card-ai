/**
 * 引导层的几何：挖洞的那条路径、气泡摆在哪。
 *
 * 纯函数，不碰 DOM，所以能直接断言——引导层唯一值得测的就是这两件事
 *（「洞真的套住了目标」和「气泡不出屏」），别的都是排版。
 */

/** 一块地方。坐标系是引导层自己那块（`position: absolute; inset: 0` 的那一层）。 */
export interface OverlayRect {
  x: number
  y: number
  w: number
  h: number
}

/** 洞比目标本身四边各放宽这么多，免得描边正压在元素边缘上。 */
export const HOLE_PADDING = 10
/** 提示气泡的宽度和它与洞之间的间距。 */
export const TIP_WIDTH = 430
const TIP_GAP = 18
/** 气泡离边至少留这么多，四角不会被切掉。 */
const TIP_MARGIN = 24
/** 气泡的估算高度，只用来判断「上面放不放得下」，真实高度由内容撑开。 */
const TIP_HEIGHT_GUESS = 84
/** 多出来的「下一步」按钮占的高度，气泡放在洞上方时要一起让开。 */
const TIP_NEXT_HEIGHT = 46

/** 把一个目标四边各放宽 `HOLE_PADDING`。 */
export function inflate(rect: OverlayRect): OverlayRect {
  return {
    x: rect.x - HOLE_PADDING,
    y: rect.y - HOLE_PADDING,
    w: rect.w + HOLE_PADDING * 2,
    h: rect.h + HOLE_PADDING * 2,
  }
}

/**
 * 压暗层的 `clip-path`：整块矩形减去那几个洞。
 *
 * 用 `path(evenodd, …)` 而不是拼一堆压暗小方块（旧版那个做法）：
 * 一层就够了，没有相邻边界的接缝，加一个洞也只是多四个点。
 * 填充规则必须写 `evenodd`——外圈和洞的绕向一样，默认的 nonzero 会把洞一起填上。
 *
 * 一个洞都没有时返回 `null`：那种步骤只压暗、不指具体元素，整层铺满就行，
 * 而空的 `path()` 在各家浏览器里表现不一（有的当成全裁掉，整层就看不见了）。
 */
export function holePath(
  holes: readonly OverlayRect[],
  width: number,
  height: number,
): string | null {
  if (holes.length === 0) return null
  const outer = `M0 0H${round(width)}V${round(height)}H0Z`
  const inner = holes
    .map((hole) => {
      const right = round(hole.x + hole.w)
      const bottom = round(hole.y + hole.h)
      return `M${round(hole.x)} ${round(hole.y)}H${right}V${bottom}H${round(hole.x)}Z`
    })
    .join('')
  return `path(evenodd, "${outer}${inner}")`
}

/**
 * 气泡摆在哪：贴着第一个洞放，洞在上半屏就放它下面、在下半屏就放它上面，
 * 一个洞都没有时摆在上方居中（那种步骤只压暗、不指具体元素）。
 * 最后统一夹回屏内，靠边的目标不会把气泡挤出画面。
 *
 * `withNext` 说的是气泡里多了一颗「下一步」：往上放的时候要多让开这颗按钮的高度，
 * 否则气泡底边会压到它指着的那个洞上。
 */
export function tipPosition(
  holes: readonly OverlayRect[],
  stage: { w: number; h: number },
  withNext: boolean,
): { x: number; y: number } {
  const height = TIP_HEIGHT_GUESS + (withNext ? TIP_NEXT_HEIGHT : 0)
  const anchor = holes[0]
  if (anchor === undefined) {
    return { x: (stage.w - TIP_WIDTH) / 2, y: stage.h * 0.18 }
  }
  const centerY = anchor.y + anchor.h / 2
  const below = centerY < stage.h / 2
  const rawY = below ? anchor.y + anchor.h + TIP_GAP : anchor.y - TIP_GAP - height
  const rawX = anchor.x + anchor.w / 2 - TIP_WIDTH / 2
  return {
    x: clamp(rawX, TIP_MARGIN, stage.w - TIP_WIDTH - TIP_MARGIN),
    y: clamp(rawY, TIP_MARGIN, stage.h - height - TIP_MARGIN),
  }
}

/**
 * 这一帧量出来的东西和上一帧一不一样，拼成一个字符串比。
 *
 * 逐帧现量是必须的（手牌会重排、卡会飞），但真的变了才重渲染——
 * 画面静止时一次 React 提交都不该发生。取整到像素：亚像素的抖动不值得重排一次。
 */
export function overlaySignature(holes: readonly OverlayRect[], stage: { w: number; h: number }) {
  const size = `${round(stage.w)}x${round(stage.h)}`
  const boxes = holes.map((r) => `${round(r.x)},${round(r.y)},${round(r.w)},${round(r.h)}`)
  return [size, ...boxes].join('|')
}

function round(value: number): number {
  return Math.round(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
