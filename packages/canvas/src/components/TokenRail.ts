/**
 * Token 细条（需求单面板 E）：一列四芒星加底下一行「7/12 token」。
 * 面板 E 只画底，星星和落款在这里；两者分工见 Panel.ts 的文件头。
 *
 * 星星**从下往上烧**：最底下那颗是第 1 点，越往上编号越大，花钱是从顶上往下灭的，
 * 像一格格烧下去的蜡烛。这条读图规则决定了下面 `starOf` 里那个翻转。
 *
 * **永远单列**。上限从 5 起、每轮 +1，点数一多就只压间距不换列——换成两列的话
 * 「从下往上烧」会断成两段，读不出还剩几点。挤到极限时间距是负的，星星互相压边，
 * 靠每颗星那圈描边分开彼此（旧版同款做法，见 legacy 的 `.battle__token-star`）。
 *
 * 星星是一整列预先建好的精灵，改状态只写 tint 和 visible，不建也不删任何对象（3.10）。
 * 池子按上限建：一局里 Token 上限只涨不跌，涨到超出池子时才补建（`ensurePool`），
 * 那一步只在回合之间发生，不在动画期间。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'
import { PANEL_TOKEN_RAIL, Panel } from './Panel'

/**
 * 细条自己的几何。这几个数只服务这一个组件，按 design 的 README「组件私有」那条留在这里。
 * 来源：legacy-client/src/ui/MatchStage.tsx 的 TOKEN_* 和 styles.css 的 `.battle__token-rail`。
 */
const GEOMETRY = {
  /** 留给星星那一列的高度预算。细条高 470 减去上下内边距、落款那两行和它们之间的空隙。 */
  stackHeight: 400,
  /** 一颗星的边长。 */
  starSize: 30,
  /** 星星之间最松和最紧的间距。负数就是让星星互相压边。 */
  gapMax: 18,
  gapMin: -18,
  /** 星星那一列离细条上沿多远。 */
  padTop: 26,
} as const

/** 落款那两行的字号（px）。上面那行是数值，下面那行是单位。 */
const TYPE = {
  value: { fontSize: 17, letterSpacing: 0 },
  unit: { fontSize: tokens.font.size.sm, letterSpacing: 1.1 },
} as const

/** 一点 Token 的三档样子。「白捡的」是「模型蒸馏」换来的、超出本轮上限的那几点。 */
const STAR_TINT = {
  left: tokens.color.theme.gold,
  spent: tokens.color.battle.lineDark,
  extra: tokens.color.accent.ai,
} as const

/** 已花掉那几颗的透明度。灭掉但还留着轮廓，才看得出「这一轮本来有几点」。 */
const SPENT_ALPHA = 0.35

/** Token 数变了那一下的跳动幅度和时长（秒）。旧版没有这一下，理由见 setTokens。 */
const BUMP_SCALE = 1.35
const BUMP_IN = 0.12
const BUMP_OUT = 0.22

export interface TokenRailDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export class TokenRail extends Container {
  readonly boxWidth: number
  readonly boxHeight: number

  private readonly deps: TokenRailDeps
  private readonly stack = new Container()
  private readonly caption = new Container()
  private readonly stars: Sprite[] = []
  private current = 0
  private max = 0

  constructor(deps: TokenRailDeps) {
    super()
    this.deps = deps
    this.label = 'token-rail'
    this.eventMode = 'none'

    const plate = new Panel({ variant: PANEL_TOKEN_RAIL }, deps)
    this.boxWidth = plate.boxWidth
    this.boxHeight = plate.boxHeight
    this.addChild(plate, this.stack, this.caption)
    this.setTokens(0, 0)
  }

  /**
   * 改 Token 数。
   *
   * @param current 还剩几点。可以超过 `max`——「模型蒸馏」换来的点顶得到上限之上，
   *   那时多出来的几颗照样各画一颗，只是换个颜色（下一轮补满时自己会缩回去）。
   * @param max 本轮上限。
   *
   * 数一变就让整列跳一下。旧版没有这个动作（DOM 那边靠颜色变化交代），
   * 加上是因为画布上一颗星灭掉只是 tint 变了一档，不动的话很容易整轮都没注意到扣了钱。
   * 跳的是整个 stack 的 scale，属于 transform，符合 3.10。
   */
  setTokens(current: number, max: number): void {
    const changed = this.current !== current || this.max !== max
    this.current = current
    this.max = max
    const shown = Math.max(max, current)
    this.ensurePool(shown)
    this.layoutStars(shown)
    this.rebuildCaption()
    if (changed && shown > 0) this.bump()
  }

  /** 池子不够就补建。只在上限涨过头时发生，不在动画期间。 */
  private ensurePool(shown: number): void {
    while (this.stars.length < shown) {
      const star = new Sprite(this.deps.ui.tokenStar)
      star.anchor.set(0.5)
      star.setSize(GEOMETRY.starSize, GEOMETRY.starSize)
      this.stack.addChild(star)
      this.stars.push(star)
    }
  }

  /**
   * 摆这一列星星，并按「还剩 / 已花 / 白捡的」上色。
   *
   * 间距按「一列装得下」现算：细条高度是固定的，星星越多间距越小，挤到 gapMin 就压边。
   * 只有一颗星时没有间隔，除数兜到 1 免得算出 Infinity。
   */
  private layoutStars(shown: number): void {
    const { stackHeight, starSize, gapMax, gapMin, padTop } = GEOMETRY
    const gap = Math.min(
      gapMax,
      Math.max(gapMin, (stackHeight - shown * starSize) / Math.max(shown - 1, 1)),
    )
    const step = starSize + gap
    // 整列在预算高度里纵向居中：点数少的时候不该全挤在顶上。
    const top = padTop + (stackHeight - (shown * starSize + Math.max(shown - 1, 0) * gap)) / 2
    this.stars.forEach((star, index) => {
      star.visible = index < shown
      if (!star.visible) return
      // index 是从上往下的行号，Token 从下往上数，翻一下：最上面那颗编号最大，也就是最先花掉的。
      const point = shown - 1 - index
      const spent = point >= this.current
      const extra = point >= this.max
      star.tint = extra ? STAR_TINT.extra : spent ? STAR_TINT.spent : STAR_TINT.left
      star.alpha = spent ? SPENT_ALPHA : 1
      star.position.set(this.boxWidth / 2, top + starSize / 2 + index * step)
    })
  }

  /** 落款那两行。数字一变就得换纹理，所以整块重建（同 TopBar 的正中那块）。 */
  private rebuildCaption(): void {
    for (const child of this.caption.removeChildren()) child.destroy({ children: true })
    const value = new Label(
      `${this.current}/${this.max}`,
      TYPE.value,
      this.deps,
      tokens.color.battle.ink,
    )
    const unit = new Label('token', TYPE.unit, this.deps, tokens.color.battle.inkMuted)
    const baseY = GEOMETRY.padTop + GEOMETRY.stackHeight + 14
    value.position.set(this.boxWidth / 2, baseY)
    unit.position.set(this.boxWidth / 2, baseY + 16)
    this.caption.addChild(value, unit)
  }

  /** 整列弹一下再回来。轴在整列的中心，所以先把 pivot 摆到那儿。 */
  private bump(): void {
    const centerY = GEOMETRY.padTop + GEOMETRY.stackHeight / 2
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
