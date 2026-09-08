/**
 * 双线雕花框（需求单边框 A）：一圈外线、一圈内线，四角各压一组折角装饰。
 *
 * 纯装饰，没有交互态，也**不吃指针事件**——它罩在内容上面，吃了的话下面的东西就点不着了。
 * 内容不进这个组件：调用方把内容挂在框旁边，框只管画线。旧版也是这么分的
 *（`ui/OrnateFrame.tsx` 把边框层和内容层拆开），换内容不用复制装饰节点。
 *
 * 线用的是 `Texture.WHITE` 拉出来的细条，不是 Graphics：框会跟着面板改大小，
 * 每改一次 Graphics 就得重画一次几何、也就多一次单独的绘制（3.9）；
 * 细条只要写 width / height / tint，改尺寸不重建任何东西（3.10）。
 * 四个角是同一张预烤纹理镜像四次，和旧版用 `scaleX(-1)` / `scaleY(-1)` 摆四个角是一回事。
 *
 * 旧版整圈套了 `#ai-duel-rough-frame` 手绘位移滤镜，这里没有（3.1 不许挂 Filter）。
 * 旧版把线拆成四条边也是为了滤镜——滤镜按包围盒算，一整圈 border 会让浏览器算满整块面板；
 * 这边不挂滤镜，拆成四条只是因为四条独立的细条本来就是最省的画法。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite, Texture } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'

/** 外线离边缘多远。抄旧样式 `.ornate-frame__edge--outer` 的 `--of-inset: 6px`。 */
const INSET_OUTER = 6
/** 内线离边缘多远。抄 `.ornate-frame__edge--inner` 的 `--of-inset: 11px`。 */
const INSET_INNER = 11
/** 线粗。旧样式两圈都是 1px 的 border。 */
const LINE = 1
/**
 * 角纹理里那道 L 的拐点离纹理左上角多远。
 *
 * 和 fx/frameShapes.ts 的 CORNER_PAD 是同一个数：那边留了这么宽的空白，
 * 好让转过 45° 之后探出去的内层线装得进纹理。摆角的时候要把这段空白减掉。
 */
const CORNER_PAD = 4

/** 四个角各自的镜像方向和它贴住的那个角。 */
const CORNERS = [
  { sx: 1, sy: 1, right: false, bottom: false },
  { sx: -1, sy: 1, right: true, bottom: false },
  { sx: 1, sy: -1, right: false, bottom: true },
  { sx: -1, sy: -1, right: true, bottom: true },
] as const

export interface OrnateFrameDeps {
  ui: UiTextures
}

export class OrnateFrame extends Container {
  private readonly outer: Sprite[] = []
  private readonly inner: Sprite[] = []
  private readonly highlight: Sprite[] = []
  private readonly corners: Container[] = []

  private boxWidth = 0
  private boxHeight = 0

  constructor(width: number, height: number, deps: OrnateFrameDeps) {
    super()
    // 装饰层不接指针事件，下面的内容才点得着。
    this.eventMode = 'none'

    for (let i = 0; i < 4; i += 1) {
      this.outer.push(this.addLine(tokens.color.battle.lineDark, 1))
      this.inner.push(this.addLine(tokens.color.battle.line, 1))
      /*
       * 内线往里 1px 那道白高光。旧版是一条带偏移的 inset 阴影，
       * 效果就是紧贴内线内侧的一条 1px 白边，这里直接画成一条一样的细条。
       */
      this.highlight.push(this.addLine('#ffffff', tokens.opacity.frame.innerHighlight))
    }
    for (const { sx, sy } of CORNERS) {
      const corner = new Container()
      const outer = new Sprite(deps.ui.frameCornerOuter)
      outer.tint = tokens.color.battle.lineDark
      const inner = new Sprite(deps.ui.frameCornerInner)
      inner.tint = tokens.color.battle.line
      corner.addChild(outer, inner)
      corner.scale.set(sx, sy)
      this.addChild(corner)
      this.corners.push(corner)
    }
    this.resize(width, height)
  }

  /**
   * 改大小。只写各条细条的位置和长度，一个对象都不重建。
   * 名字不叫 setSize：Container 自己有一个同名方法（按包围盒缩放），盖掉会让人以为是那个。
   */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.layoutRing(this.outer, INSET_OUTER)
    this.layoutRing(this.inner, INSET_INNER)
    // 高光贴在内线**里侧**，所以再往里挪一个线宽。
    this.layoutRing(this.highlight, INSET_INNER + LINE)
    this.layoutCorners()
  }

  private addLine(color: string, alpha: number): Sprite {
    const sprite = new Sprite(Texture.WHITE)
    sprite.tint = color
    sprite.alpha = alpha
    this.addChild(sprite)
    return sprite
  }

  /**
   * 摆一圈四条边：上、下、左、右。
   *
   * 四条边首尾相接而不是各画各的：横的两条画满整宽、竖的两条让开横条的厚度，
   * 四个角上就不会因为重叠而多出一小块更实的颜色。
   */
  private layoutRing(ring: Sprite[], inset: number): void {
    const x = inset
    const w = this.boxWidth - inset * 2
    const h = this.boxHeight - inset * 2
    const [top, bottom, left, right] = ring as [Sprite, Sprite, Sprite, Sprite]
    top.position.set(x, x)
    top.setSize(w, LINE)
    bottom.position.set(x, this.boxHeight - x - LINE)
    bottom.setSize(w, LINE)
    left.position.set(x, x + LINE)
    left.setSize(LINE, h - LINE * 2)
    right.position.set(this.boxWidth - x - LINE, x + LINE)
    right.setSize(LINE, h - LINE * 2)
  }

  /**
   * 把四个角贴到框的四角上。
   *
   * 镜像是靠 scale 的负号做的，负号那一轴的原点会跑到另一边，所以位置要按角来算：
   * 左上角摆在 (6 − pad, 6 − pad)，右上角摆在 (宽 − 6 + pad, 6 − pad)，以此类推。
   * 那 6 就是外线的 inset——旧版四个角也是贴着外线摆的。
   */
  private layoutCorners(): void {
    for (let i = 0; i < CORNERS.length; i += 1) {
      const { right, bottom } = CORNERS[i]!
      const corner = this.corners[i]!
      const offset = INSET_OUTER - CORNER_PAD
      corner.position.set(
        right ? this.boxWidth - offset : offset,
        bottom ? this.boxHeight - offset : offset,
      )
    }
  }
}
