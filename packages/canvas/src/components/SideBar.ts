/**
 * 对局左侧栏：一块纸底（需求单面板 B）上下等分两块玩家面板，中间一条带宝石的分隔线
 *（边框 F），顶上吊一块「下一题」纸匾（面板 F）。
 *
 * 这个组件只做**组装**：两块面板各自的内容由它们自己管，侧栏只决定谁在上、谁在下、
 * 各占多高。上下的分工是固定的——**上面是对方、下面是我**，和旧版一致；
 * 场景不用再传"哪块是谁的"，只要 `mine` / `theirs` 两个取值器分别去设。
 *
 * 纸匾报的是「下一题考什么方向」，不是题面：题目全文要到答题阶段才揭晓。
 * 匾上那行类别名会变（每轮一个方向），所以 `setNextCategory` 换的是整个 Label
 * ——Label 建好之后没有能改内容的东西（见 Label.ts 的文件头）。
 *
 * 纸匾吊在侧栏**顶边之上**：它的原点是吊绳顶端（见 Panel.ts 的 drawCords），
 * 所以整块匾要往上挪一整个匾高才不会压住上面那块玩家面板。旧版是把它绝对定位在
 * 右上角、脱离侧栏的文档流，这里改成留一条真的空档给它——画布上没有"脱离文档流"这回事，
 * 压上去就是真的把面板盖住了。
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { DIVIDER_GEM, Divider } from './Divider'
import { Label } from './Label'
import { PANEL_NEXT_PLAQUE, PANEL_SIDEBAR, Panel } from './Panel'
import { PlayerPanel, type PlayerPanelDeps } from './PlayerPanel'

/**
 * 纸匾上那两行字的字号和字距（px）。组件私有，理由见 design 的 README。
 * 来源：legacy-client/src/styles.css 的 `.battle__next-plaque-eyebrow` / `-title`。
 */
const TYPE = {
  eyebrow: { fontSize: tokens.font.size.md, letterSpacing: 2.4 },
  title: { fontSize: 22, letterSpacing: 2.2 },
} as const

/** 侧栏左右留白。两块面板和分隔线都在这个范围里。 */
const PAD_X = 12
/** 纸匾和它下面那块玩家面板之间留多宽。 */
const PLAQUE_GAP = 10

/**
 * 侧栏自己只要三样，但它要把整份依赖原样递给两块玩家面板——
 * 那两块里的「发动技能」钮是匾额按钮，按下时要调触感和音效（见 PlayerPanel）。
 */
export interface SideBarDeps extends PlayerPanelDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export interface SideBarOptions {
  width: number
  height: number
}

export class SideBar extends Container {
  /** 上面那块，对方的。 */
  readonly theirs: PlayerPanel
  /** 下面那块，我方的。Token 细条只有这一侧有（同旧版：看不到对手还剩几点）。 */
  readonly mine: PlayerPanel

  private readonly deps: SideBarDeps
  private readonly plaqueSlot = new Container()
  private readonly nextTitle = new Container()
  private plate: Panel
  private divider: Divider
  private boxWidth: number
  private boxHeight: number

  constructor(options: SideBarOptions, deps: SideBarDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.label = 'side-bar'

    this.plate = new Panel(
      { variant: PANEL_SIDEBAR, width: options.width, height: options.height },
      deps,
    )
    this.divider = new Divider({ variant: DIVIDER_GEM, length: options.width - PAD_X * 2 }, deps)

    const size = this.panelSize()
    this.theirs = new PlayerPanel({ ...size }, deps)
    this.mine = new PlayerPanel({ ...size, tokens: true }, deps)

    this.buildPlaque()
    this.addChild(this.plate, this.theirs, this.divider, this.mine, this.plaqueSlot)
    this.layout()
  }

  /** 改大小。底板和分隔线的几何是画死的，所以那两样换新的；两块面板走自己的 resize。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    this.plate = this.swap(
      this.plate,
      new Panel({ variant: PANEL_SIDEBAR, width, height }, this.deps),
    )
    this.divider = this.swap(
      this.divider,
      new Divider({ variant: DIVIDER_GEM, length: width - PAD_X * 2 }, this.deps),
    )
    const size = this.panelSize()
    this.theirs.resize(size.width, size.height)
    this.mine.resize(size.width, size.height)
    this.layout()
  }

  /** 换纸匾上那行类别名。传的是已经译好的中文（「历史掌故」这类），组件不查表。 */
  setNextCategory(category: string): void {
    for (const child of this.nextTitle.removeChildren()) child.destroy({ children: true })
    const title = new Label(category, TYPE.title, this.deps, tokens.color.battle.ink)
    const { width, height } = tokens.size.nextPlaque
    title.position.set(width / 2, tokens.size.nextPlaque.cordLength + height * 0.62)
    this.nextTitle.addChild(title)
  }

  /**
   * 两块玩家面板各多大。
   *
   * 纸匾占掉顶上一截（匾体加吊绳，再加和面板之间的空隙），剩下的高度上下等分，
   * 中间还要留出分隔线那一行。分隔线本身没有厚度可言（一条 1px 的细线加一颗菱形），
   * 按菱形的对角线留一格就够。
   */
  private panelSize(): { width: number; height: number } {
    const plaqueBlock =
      tokens.size.nextPlaque.height + tokens.size.nextPlaque.cordLength + PLAQUE_GAP
    const gemRow = tokens.size.frame.gem * Math.SQRT2 + PLAQUE_GAP
    const usable = Math.max(0, this.boxHeight - plaqueBlock - gemRow)
    return { width: this.boxWidth - PAD_X * 2, height: usable / 2 }
  }

  private buildPlaque(): void {
    const plaque = new Panel({ variant: PANEL_NEXT_PLAQUE }, this.deps)
    const eyebrow = new Label('下一题', TYPE.eyebrow, this.deps, tokens.color.battle.inkMuted)
    const { width, height } = tokens.size.nextPlaque
    eyebrow.position.set(width / 2, tokens.size.nextPlaque.cordLength + height * 0.33)
    this.plaqueSlot.addChild(plaque, eyebrow, this.nextTitle)
  }

  /** 把纸匾、两块面板和分隔线摆好。 */
  private layout(): void {
    const size = this.panelSize()
    const plaqueBlock = tokens.size.nextPlaque.height + tokens.size.nextPlaque.cordLength

    this.plaqueSlot.position.set((this.boxWidth - tokens.size.nextPlaque.width) / 2, 0)
    this.theirs.position.set(PAD_X, plaqueBlock + PLAQUE_GAP)
    const dividerY = this.theirs.y + size.height + PLAQUE_GAP / 2
    this.divider.position.set(PAD_X, dividerY)
    this.mine.position.set(PAD_X, dividerY + PLAQUE_GAP / 2)
  }

  /** 换掉一个几何画死的子节点，并保住它原来的层级。 */
  private swap<T extends Container>(old: T, next: T): T {
    const index = this.getChildIndex(old)
    this.removeChild(old)
    old.destroy({ children: true })
    this.addChildAt(next, index)
    return next
  }
}
