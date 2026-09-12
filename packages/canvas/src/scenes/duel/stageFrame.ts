/**
 * 舞台四周那一圈：底下垫一块，四边再盖一圈，把溢出设计稿的东西挡在外面。
 *
 * 桌面档的舞台是 1672×941 的死版式等比缩放居中放进视口（见 layout/desktopLayout.ts），
 * 视口比例和它对不上时短边会多出两条边。黑客松版那边是 `overflow: hidden` 裁掉的，
 * 画布上没有这回事——**画到舞台外面的东西照样画出来**。这一页真有东西画到外面：
 * 对手那排扇形钉在舞台顶边，两端的牌往上垂十几个像素，正好探进上边那条。
 *
 * 不用遮罩来裁：遮罩会和展示层的顶栏裁剪、结算层擦答案那两处嵌套起来，
 * 而模板缓冲的嵌套在各后端上的表现并不一致（4.4 要求各浏览器一样）。
 * 改成「在舞台**上面**盖四条不透明的边」，效果一样，画的还是纯色矩形。
 */

import { type Container, Graphics } from 'pixi.js'
import { CANVAS_BACKGROUND } from '../../components/Box'

/**
 * 画这一圈要知道的全部：舞台多大、缩放居中之后落在视口的哪儿。
 *
 * 写成结构类型而不是收 `DuelLayout`：构筑页桌面档也是一块死版式整块缩放（见
 * scenes/deck/layout/desktopLayout.ts），两页要的是同一圈挡边，没必要各画一份。
 */
export interface StageFrameLayout {
  width: number
  height: number
  viewport: { width: number; height: number }
  stage: { scale: number; x: number; y: number }
}

/** 四条边的顺序：上、下、左、右。只是给下面那个循环起个名字。 */
const EDGES = 4

/**
 * 画底和那一圈边。
 *
 * @param backdrop 垫在舞台**下面**那一块，铺满整个视口；传 null 就不画。
 *   只有挂在别人渲染器上的那一档（组件目录页）要它——那边改不了渲染器的底色，
 *   不垫的话深色描边会压在目录页的深底上看不见。自己建渲染器的那条路已经把清屏色
 *   设成同一个颜色了，再垫一块等于凭空多一层满屏绘制。
 * @param letterbox 盖在舞台**上面**那一圈，里面是四块各管一条边的 `Graphics`。
 *   舞台正好铺满视口时四块全都藏起来。
 */
export function paintStageFrame(
  backdrop: Graphics | null,
  letterbox: Container,
  layout: StageFrameLayout,
): void {
  const { viewport, stage, width, height } = layout
  backdrop?.clear().rect(0, 0, viewport.width, viewport.height).fill({ color: CANVAS_BACKGROUND })

  const left = stage.x
  const top = stage.y
  const right = left + width * stage.scale
  const bottom = top + height * stage.scale
  /*
   * 上下两条通宽、左右两条只补中间那一截，四条加起来正好是「视口减去舞台」。
   *
   * **四条各占一块 `Graphics`**，不合成一块画四个矩形：过度绘制那条指标把每个 Graphics
   * 按它的**包围盒**算成一整块实心（见 bench 的 src/page/overdraw.ts），
   * 四条合成一块的包围盒就是整个视口——明明只画了边上几百个像素，却要按满屏记一笔。
   */
  const bars = [
    { x: 0, y: 0, width: viewport.width, height: top },
    { x: 0, y: bottom, width: viewport.width, height: viewport.height - bottom },
    { x: 0, y: top, width: left, height: bottom - top },
    { x: right, y: top, width: viewport.width - right, height: bottom - top },
  ]
  ensureBars(letterbox)
  bars.forEach((bar, index) => {
    const node = letterbox.children[index] as Graphics
    const empty = bar.width <= 0 || bar.height <= 0
    node.visible = !empty
    if (empty) return
    node.clear().rect(bar.x, bar.y, bar.width, bar.height).fill({ color: CANVAS_BACKGROUND })
  })
}

/** 头一次画的时候把四块建出来。之后每次只改它们自己的几何。 */
function ensureBars(letterbox: Container): void {
  while (letterbox.children.length < EDGES) {
    const bar = new Graphics()
    bar.eventMode = 'none'
    letterbox.addChild(bar)
  }
}
