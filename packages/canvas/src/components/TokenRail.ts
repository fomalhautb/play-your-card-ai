/**
 * Token 细条：一条竖着的素方块，里面按点数摆一列小格，底下一格写「还剩几 / 一共几」。
 *
 * 正式版简化第 4 步之二剥成素方块（见 components/Box.ts）：从前的纸面底、四芒星和
 * 三档配色全删了。「还剩 / 已花」只用透明度分（`Box.setDisabled`）——换色就等于又开始定配色了。
 *
 * 小格**从下往上烧**：最底下那格是第 1 点，越往上编号越大，花钱是从顶上往下灭的，
 * 像一格格烧下去的蜡烛。这条读图规则决定了下面 `layoutCells` 里那个翻转。
 *
 * **永远单列**。上限从 5 起、每轮 +1，点数一多就只压间距不换列——换成两列的话
 * 「从下往上烧」会断成两段，读不出还剩几点。挤到极限时间距是负的，小格互相压边。
 *
 * 小格是一整列预先建好的方块，改状态只写 alpha 和 visible，不建也不删任何对象（3.10）。
 * 池子按上限建：一局里 Token 上限只涨不跌，涨到超出池子时才补建（`ensurePool`），
 * 那一步只在回合之间发生，不在动画期间。
 *
 * 桌面档它贴在舞台右缘自己站着，手机档仍然挂在我方玩家面板里（那一档没有贴边的地方），
 * 两处摆在哪儿由版式和面板决定，这里只管自己那 44×470。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'

/**
 * 细条自己的几何。这几个数只服务这一个组件，按 design 的 README「组件私有」那条留在这里。
 * 高度预算：底下那格落款 24 高，上下各留 10，剩下的全归小格那一列。
 */
const GEOMETRY = {
  /** 一格的边长。细条宽 44，左右各留 11。 */
  cellSize: 22,
  /** 小格之间最松和最紧的间距。负数就是让小格互相压边。 */
  gapMax: 14,
  gapMin: -14,
  /** 落款那一格多高，以及整条上下左右的留白。 */
  captionHeight: 24,
  pad: 10,
} as const

/** 数变了那一下的跳动幅度和时长（秒）。画布上一格灭掉只是透明度变了，不动很容易整轮没注意到。 */
const BUMP_SCALE = 1.35
const BUMP_IN = 0.12
const BUMP_OUT = 0.22

export interface TokenRailDeps extends BoxDeps {
  animator: Animator
}

export class TokenRail extends Container {
  readonly boxWidth = tokens.size.rail.width
  readonly boxHeight = tokens.size.rail.height

  private readonly deps: TokenRailDeps
  private readonly stack = new Container()
  private readonly caption: Box
  private readonly cells: Box[] = []
  private current = 0
  private max = 0

  constructor(deps: TokenRailDeps) {
    super()
    this.deps = deps
    this.label = 'token-rail'
    this.eventMode = 'none'

    const plate = new Box({ width: this.boxWidth, height: this.boxHeight }, deps)
    this.caption = new Box(
      { width: this.boxWidth, height: GEOMETRY.captionHeight, label: '0/0', size: 'small' },
      deps,
    )
    this.caption.position.set(0, this.boxHeight - GEOMETRY.captionHeight)
    this.addChild(plate, this.stack, this.caption)
    this.setTokens(0, 0)
  }

  /**
   * 改 Token 数。
   *
   * @param current 还剩几点。可以超过 `max`——「模型蒸馏」换来的点顶得到上限之上，
   *   那时多出来的几格照样各画一格（下一轮补满时自己会缩回去）。
   * @param max 本轮上限。
   */
  setTokens(current: number, max: number): void {
    const changed = this.current !== current || this.max !== max
    this.current = current
    this.max = max
    const shown = Math.max(max, current)
    this.ensurePool(shown)
    this.layoutCells(shown)
    this.caption.setLabel(`${current}/${max}`)
    if (changed && shown > 0) this.bump()
  }

  /** 池子不够就补建。只在上限涨过头时发生，不在动画期间。 */
  private ensurePool(shown: number): void {
    while (this.cells.length < shown) {
      const cell = new Box({ width: GEOMETRY.cellSize, height: GEOMETRY.cellSize }, this.deps)
      this.stack.addChild(cell)
      this.cells.push(cell)
    }
  }

  /**
   * 摆这一列小格，并按「还剩 / 已花」定透明度。
   *
   * 间距按「一列装得下」现算：细条高度是固定的，格子越多间距越小，挤到 gapMin 就压边。
   * 只有一格时没有间隔，除数兜到 1 免得算出 Infinity。
   */
  private layoutCells(shown: number): void {
    const { cellSize, gapMax, gapMin, captionHeight, pad } = GEOMETRY
    const room = this.boxHeight - captionHeight - pad * 2
    const gap = Math.min(
      gapMax,
      Math.max(gapMin, (room - shown * cellSize) / Math.max(shown - 1, 1)),
    )
    const step = cellSize + gap
    // 整列在预算高度里纵向居中：点数少的时候不该全挤在顶上。
    const top = pad + (room - (shown * cellSize + Math.max(shown - 1, 0) * gap)) / 2
    this.cells.forEach((cell, index) => {
      cell.visible = index < shown
      if (!cell.visible) return
      // index 是从上往下的行号，Token 从下往上数，翻一下：最上面那格编号最大，也就是最先花掉的。
      const point = shown - 1 - index
      cell.setDisabled(point >= this.current)
      cell.position.set((this.boxWidth - cellSize) / 2, top + index * step)
    })
  }

  /** 整列弹一下再回来。轴在整列的中心，所以先把 pivot 摆到那儿。 */
  private bump(): void {
    const centerY = (this.boxHeight - GEOMETRY.captionHeight) / 2
    this.stack.pivot.set(this.boxWidth / 2, centerY)
    this.stack.position.set(this.boxWidth / 2, centerY)
    const timeline = this.deps.animator.timeline()
    timeline.to(this.stack.scale, {
      x: BUMP_SCALE,
      y: BUMP_SCALE,
      duration: BUMP_IN,
      ease: 'power2.out',
    })
    timeline.to(this.stack.scale, { x: 1, y: 1, duration: BUMP_OUT, ease: 'back.out(2)' })
  }
}
