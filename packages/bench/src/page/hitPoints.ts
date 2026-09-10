/**
 * 「这个东西在屏幕的哪儿点得到」——交互用例（tests/interaction.spec.ts）拿它找按哪儿。
 *
 * 用真指针驱动画面绕不开一个问题：Playwright 只会往视口坐标发事件，而卡在屏幕上的位置
 * 由版式、扇形几何和这一刻的动画共同决定，Node 那边算不出来。契约里也不该为此多开接口
 *（`BenchScene` 只说「开局、出牌、放大查看」这几件事）。
 *
 * 所以这里走和过度绘制同一条路：从 `renderProbe` 抓到的场景树上找目标，
 * 再用 **Pixi 自己的命中测试**（`EventBoundary.hitTest`）验一遍「点这个坐标真的会命中它」。
 * 自己算包围盒是不够的：手牌扇形里的卡互相压着一大半，算出来的中心点很可能落在邻座那张上，
 * 用例会莫名其妙地打出另一张牌。验一遍之后返回的坐标点下去命中的一定是它。
 */

import type { Container } from 'pixi.js'
import type { RenderProbe } from './renderProbe'

/** 一个点得到的目标：它的 label，和一个点下去会命中它的**视口**坐标。 */
export interface HitPoint {
  label: string
  x: number
  y: number
}

/**
 * 每个目标试哪几个局部坐标，按「最稳的先试」排。
 *
 * 两种原点混在一张表里：卡面的原点在**底边中点**，命中区是 x ∈ [−75, 75]、y ∈ [−225, 0]
 *（见 canvas 的 components/CardSprite.ts）；战场格子的原点在格子**中心**。
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

/**
 * 场景图里 label 以 `prefix` 开头的对象，各给一个点得到的视口坐标。
 *
 * 命中不了的（被别的东西完全盖住、藏起来了、alpha 为 0）整个不返回——
 * 与其给一个点下去没反应的坐标，不如让用例当场看到「这东西现在点不到」。
 */
export function hitPointsOf(probe: RenderProbe, prefix: string): HitPoint[] {
  const renderer = probe.renderer()
  const stage = probe.stage()
  if (!renderer || !stage) throw new Error('没抓到 Pixi 的渲染调用，找不到命中点')

  const boundary = renderer.events.rootBoundary
  /*
   * rootTarget 平时是 EventSystem 在收到每个 DOM 事件时才写的。这里要在没有任何真事件
   * 发生的情况下做命中测试，所以先自己对上——不对的话 hitTest 会在 null 上取属性直接抛。
   */
  boundary.rootTarget = renderer.lastObjectRendered ?? stage

  const targets: Container[] = []
  collect(stage, prefix, targets)

  const points: HitPoint[] = []
  for (const target of targets) {
    for (const local of CANDIDATES) {
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
}
