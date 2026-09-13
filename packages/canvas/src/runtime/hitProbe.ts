/**
 * 「这个东西在屏幕的哪儿点得到」——给真浏览器里的自动化测试用的调试口子。
 *
 * 用真指针驱动画面绕不开一个问题：Playwright 只会往视口坐标发事件，而一张卡在屏幕上的位置
 * 由版式、扇形几何和这一刻的动画共同决定，Node 那边算不出来。场景契约里也不该为此多开接口
 *（`DuelScene` 只说「摆局面、播 cue、推一帧」这几件事），所以这里从**渲染出去的那棵树**上
 * 反查，再用 **Pixi 自己的命中测试**（`EventBoundary.hitTest`）验一遍
 * 「点这个坐标真的会命中它」。
 *
 * 自己算包围盒是不够的：手牌扇形里的卡互相压着一大半，算出来的中心点很可能落在邻座那张上，
 * 用例会莫名其妙地打出另一张牌。验一遍之后返回的坐标点下去命中的一定是它。
 *
 * ## 为什么要包 `render`
 *
 * 拿不到 renderer 和 stage：场景自己建渲染器、契约里不对外给。包一层
 * `WebGLRenderer.prototype.render` 就什么都不用它配合——只要是用 Pixi 渲染的就抓得到。
 * 代价是必须在**那棵树被渲染过至少一次之后**才问得出东西来；调用方（bench 的页面骨架、
 * client 的 dev 调试口子）都是在建场景之前就装好这一层的。
 *
 * 前提是两边解析到同一份 pixi.js。pnpm 里同版本指向 store 里同一个目录，打包时是同一个
 * 模块实例，所以补在原型上的这一层两边都生效；版本对不上时 `stage()` 会一直是 null，
 * 上面几个方法返回空而不是给一个假坐标。
 *
 * 这个文件只被测试骨架和 dev 调试口子 import，不在任何一条正式界面的路径上。
 */

import { Container, Rectangle, type Renderer, WebGLRenderer } from 'pixi.js'

/** 一个点得到的目标：它的 label，和一个点下去会命中它的**视口**坐标。 */
export interface HitPoint {
  label: string
  x: number
  y: number
}

/** 屏幕上的一块矩形（视口坐标）。 */
export interface HitBox {
  x: number
  y: number
  width: number
  height: number
}

export interface HitProbe {
  /** 最后一次画到屏幕上的那个渲染器。还没画过就是 null。 */
  renderer(): Renderer | null
  /** 最后一次画到屏幕上的那棵树的根。还没画过就是 null。 */
  stage(): Container | null
  /**
   * label 以 `prefix` 开头、而且此刻真点得到的那些对象，各给一个坐标。
   *
   * @param within 只要这个 label 的对象（或它自己）底下的那些。手牌和战场上的卡 label
   *   同一个前缀，要分开就靠它（传 `'hand-fan'` 只拿扇形里的）。
   */
  pointsOf(prefix: string, within?: string): HitPoint[]
  /** 这个视口坐标点下去会命中谁：返回命中对象或它最近一个有 label 的祖先的 label；点空返回 null。 */
  labelAt(x: number, y: number): string | null
  /** label 正好等于 `label` 的那个对象在屏幕上占的矩形。找不到返回 null。 */
  boxOf(label: string): HitBox | null
}

/**
 * 每个目标试哪几个局部坐标，按「最稳的先试」排。
 *
 * 两种原点混在一张表里：卡面的原点在**底边中点**，命中区是 x ∈ [−75, 75]、y ∈ [−225, 0]
 *（见 components/CardSprite.ts）；战场格子的原点在格子**中心**。
 * 所以前几个是卡的（负 y 才在卡面上），`{0, 0}` 那个才是格子的。
 * 对不上的候选会被下面那次命中验证直接刷掉，混在一起不会给错答案。
 *
 * **一个都不能踩在命中区的边线上**：`Rectangle.contains` 对右边界和下边界是开区间，
 * 而卡的原点 `{0, 0}` 正好落在下边界上——能不能命中全看浮点误差往哪边偏，
 * 而且指针坐标还要取整一次。踩在边上的点会时好时坏，那种失败最难查。
 */
const CANDIDATES: readonly { x: number; y: number }[] = [
  { x: 0, y: -112 },
  { x: 0, y: -180 },
  { x: 0, y: -60 },
  { x: -45, y: -112 },
  { x: 45, y: -112 },
  { x: 0, y: 0 },
]

/**
 * 自己声明了矩形命中区的（按钮那一类），先试它的中心。
 *
 * 上面那张表全是按卡和格子的原点排的，而按钮的原点在**左上角**，那几个点一个都落不到它身上。
 * 命中区是它自己说的「点这块算点我」，取中心最稳。
 */
function candidatesFor(target: Container): readonly { x: number; y: number }[] {
  const area = target.hitArea
  if (!(area instanceof Rectangle)) return CANDIDATES
  return [{ x: area.x + area.width / 2, y: area.y + area.height / 2 }, ...CANDIDATES]
}

/** 深度优先遍历整棵树，收下 label 以 prefix 开头的那些。 */
function collect(node: Container, prefix: string, out: Container[]): void {
  if (typeof node.label === 'string' && node.label.startsWith(prefix)) out.push(node)
  for (const child of node.children) collect(child as Container, prefix, out)
}

/** hit 是不是 target 自己或者它的后代。格子本身没有命中区，命中的是它里面那张卡。 */
function isWithin(hit: Container | null, target: Container): boolean {
  let node: Container | null = hit
  while (node !== null) {
    if (node === target) return true
    node = node.parent as Container | null
  }
  return false
}

/** node 自己或者某个祖先的 label 是不是 `label`。 */
function hasAncestor(node: Container, label: string): boolean {
  let cursor: Container | null = node
  while (cursor !== null) {
    if (cursor.label === label) return true
    cursor = cursor.parent as Container | null
  }
  return false
}

/** 从 node 往上找第一个有 label 的（含自己）。 */
function labelOf(node: Container | null): string | null {
  let cursor: Container | null = node
  while (cursor !== null) {
    if (typeof cursor.label === 'string' && cursor.label.length > 0) return cursor.label
    cursor = cursor.parent as Container | null
  }
  return null
}

let installed: HitProbe | null = null

/**
 * 装上这一层（幂等：第二次调用返回同一个探针）。
 *
 * 一定要在**建场景之前**调：它靠包 `render` 记住「最后画的是哪棵树」，
 * 而帧循环在没有动画时会停下来（纪律 3.6），晚装的话可能一直等不到下一帧。
 */
export function installHitProbe(): HitProbe {
  if (installed) return installed

  let lastRenderer: Renderer | null = null
  let lastStage: Container | null = null

  // render 有多个重载，按重载签名去包会对不上类型，所以降成「任意参数」再补回去。
  type RenderFn = (this: WebGLRenderer, ...args: unknown[]) => void
  const holder = WebGLRenderer.prototype as unknown as { render: RenderFn }
  const original = holder.render
  holder.render = function patched(this: WebGLRenderer, ...args: unknown[]) {
    const first = args[0]
    lastRenderer = this
    /*
     * 只记**画到屏幕上**的那次，带 `target` 的一概不记。
     *
     * 烤纹理走的是同一个 render（`renderer.render({ container, target })`：文字缓存、
     * 预烤纹理都是），而那些容器只有几个节点。不区分的话，随便一句新文字被烤出来，
     * `stage()` 就从整棵场景树变成那几个节点，之后问「场景里有什么」得到的是空的——
     * 而且下一帧一渲染又自己好了，现场极难查。
     */
    const target = (first as { target?: unknown } | undefined)?.target
    if (target === undefined || target === null) {
      lastStage =
        first instanceof Container
          ? first
          : ((first as { container?: Container } | undefined)?.container ?? null)
    }
    return original.apply(this, args)
  }

  /**
   * 拿到能做命中测试的那个边界。
   *
   * `rootTarget` 平时是 EventSystem 在收到每个 DOM 事件时才写的。这里要在没有任何真事件
   * 发生的情况下做命中测试，所以先自己对上——不对的话 hitTest 会在 null 上取属性直接抛。
   */
  const boundaryOf = () => {
    if (!lastRenderer || !lastStage) return null
    const boundary = lastRenderer.events.rootBoundary
    boundary.rootTarget = lastRenderer.lastObjectRendered ?? lastStage
    return boundary
  }

  installed = {
    renderer: () => lastRenderer,
    stage: () => lastStage,

    pointsOf(prefix, within) {
      const boundary = boundaryOf()
      if (boundary === null || lastStage === null) return []
      const found: Container[] = []
      collect(lastStage, prefix, found)
      const targets =
        within === undefined ? found : found.filter((node) => hasAncestor(node, within))
      const points: HitPoint[] = []
      for (const target of targets) {
        for (const local of candidatesFor(target)) {
          const global = target.toGlobal(local)
          /*
           * 验的是**取整之后**那个点。
           *
           * 指针事件的坐标是整数（CDP 那边就是这么发的），所以「验一个小数点、发一个整数点」
           * 等于没验：差半个像素就可能从卡上掉下去。这里直接按最后真会用的那个坐标验。
           */
          const x = Math.round(global.x)
          const y = Math.round(global.y)
          if (!isWithin(boundary.hitTest(x, y), target)) continue
          points.push({ label: String(target.label), x, y })
          break
        }
      }
      return points
    },

    labelAt(x, y) {
      const boundary = boundaryOf()
      if (boundary === null) return null
      return labelOf(boundary.hitTest(Math.round(x), Math.round(y)))
    },

    boxOf(label) {
      if (lastStage === null) return null
      const found: Container[] = []
      collect(lastStage, label, found)
      const target = found.find((node) => node.label === label)
      if (target === undefined) return null
      const bounds = target.getBounds()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    },
  }
  return installed
}
