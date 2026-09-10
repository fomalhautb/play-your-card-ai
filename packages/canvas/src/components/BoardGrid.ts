/**
 * 战场：上下两排卡槽（需求单列表 A），中间一条横杆（边框 E）嵌一枚回合徽章（徽章 E）。
 * 每格的样子见 BoardTile；这里管的是**排位**和**场上单位的增删改**。
 *
 * 上面那排是对方、下面那排是我方，和旧版一致。这条读图规则是硬的，所以：
 * **一排永不换行**。折出第二排会越过中线戳进对方那半边，「线上面是他、线下面是我」就废了。
 * 张数多到摆不下时改成让每张卡互相压边（同手牌扇形挤在一起时的处理），
 * 相邻两张之间保住 `MIN_GAP` 的下限，每张至少露出一条边。
 *
 * 每排上限：core 的引擎**不封顶**（`playCard` 直接往 `player.board` 里 push），
 * 所以这里也不设上限，靠压边扛住。一局里题库五道题、Token 上限最多十来点，
 * 实际不会超过七八张——压边的余量很宽裕。
 *
 * 几段特效的时长全部 import `director/timings.ts`，不在这里抄第二份数字：
 * 罚下（`removal-fx`）、进化（`evolve-fx`）、简易进场（`pop-in`），以及同批进化之间的错开量。
 * 上场落地（`summon-fx`）和技能命中（`hit-fx`）不在这里——那两段归 fx/HitFx，
 * 这里只用 `tileAt` 把落点交出去。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import { EVOLVE_FX_MS, EVOLVE_STAGGER_MS, POP_IN_MS, REMOVAL_FX_MS } from '../director/timings'
import type { UiTextures } from '../fx/uiTextures'
import type { Animator } from '../runtime/animator'
import { killAndDestroy } from '../runtime/dispose'
import type { TextTextureCache } from '../runtime/textCache'
import { Badge } from './Badge'
import { BoardTile, type TileMark } from './BoardTile'
import type { CardSprite } from './CardSprite'
import { DIVIDER_MIDLINE, Divider } from './Divider'
import { Label } from './Label'

/** 哪一排。和 cue 里的 `side` 同名同义。 */
export type BoardSide = 'self' | 'opponent'

/** 相邻两格之间至少留多宽。抄旧样式 `.battle__row` 的 `gap: 12px`。 */
const MIN_GAP = 12
/** 没挤到压边时，相邻两格的中心相距多远（格宽的倍数）。抄 duelLayout 里落点那一档。 */
const SLOT_STEP = 1.12
/** 中线上下各留多高。抄 `.battle__midline` 的 `margin: 5px 0`。 */
const MIDLINE_MARGIN = 5

/** 进化那一下的三样动作。数值抄 legacy 的 playSummonFx.ts，时长走 timings。 */
const EVOLVE = { popScale: 1.16, popDur: 0.42, glowDur: 0.7, labelRise: 34 } as const
/** 罚下时那张卡往下沉多少。抄 playSummonFx.ts 的 `REMOVAL_DROP`。 */
const REMOVAL_DROP = 26
/** 简易进场从多小弹起来、用哪档回弹。抄旧版 MatchStage.tsx:2322-2328 的那条 fromTo。 */
const POP_IN = { fromScale: 0.6, ease: 'back.out(1.7)' } as const
/** 进化浮字的字号（px）。组件私有，理由见 design 的 README。 */
const EVOLVE_LABEL = { fontSize: 20, letterSpacing: 2, weight: '600' } as const

export interface BoardGridDeps {
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export interface BoardGridOptions {
  width: number
  height: number
}

export class BoardGrid extends Container {
  private readonly deps: BoardGridDeps
  private readonly rows: Record<BoardSide, Container> = {
    opponent: new Container(),
    self: new Container(),
  }
  private readonly tiles = new Map<string, { tile: BoardTile; side: BoardSide }>()
  /** 特效（进化的辉光和浮字）画在这一层，压在两排之上、不吃指针事件。 */
  private readonly fxLayer = new Container()
  private readonly badgeSlot = new Container()
  private midline: Divider
  private boxWidth: number
  private boxHeight: number

  constructor(options: BoardGridOptions, deps: BoardGridDeps) {
    super()
    this.deps = deps
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.label = 'board-grid'

    this.midline = new Divider({ variant: DIVIDER_MIDLINE, length: options.width, gap: 0 }, deps)
    this.fxLayer.eventMode = 'none'
    this.addChild(this.rows.opponent, this.rows.self, this.midline, this.badgeSlot, this.fxLayer)
    this.layout()
  }

  /** 改大小。中线的几何是画死的，换一条新的；两排重新排位。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.boxHeight = height
    const index = this.getChildIndex(this.midline)
    this.removeChild(this.midline)
    this.midline.destroy({ children: true })
    this.midline = new Divider(
      { variant: DIVIDER_MIDLINE, length: width, gap: this.badgeGap() },
      this.deps,
    )
    this.addChildAt(this.midline, index)
    this.layout()
  }

  /**
   * 往某一排放一个单位。返回建好的格子，调用方拿它接着播落地特效。
   * 卡由调用方建；重复的 instanceId 会被忽略——同一个单位不可能上场两次。
   */
  place(instanceId: string, card: CardSprite, side: BoardSide): BoardTile | null {
    if (this.tiles.has(instanceId)) return null
    const tile = new BoardTile(instanceId, card, this.deps)
    this.tiles.set(instanceId, { tile, side })
    this.rows[side].addChild(tile)
    this.layoutRow(side)
    return tile
  }

  /**
   * 把一个单位罚下：那张卡沉下去化掉，演完才从排里摘掉。
   *
   * 摘掉这一步排在补间的收尾里，不是当场摘——当场摘的话同排剩下的卡会在特效还演着的时候
   * 就开始合拢，看着像那张卡是"被挤走"的而不是"化掉"的。
   * 返回整段的时长（毫秒），和 cue 里的 `durationMs` 是同一个数。
   */
  remove(instanceId: string): number {
    const entry = this.tiles.get(instanceId)
    if (entry === undefined) return 0
    this.tiles.delete(instanceId)
    const { tile, side } = entry
    const duration = REMOVAL_FX_MS / 1000
    this.deps.animator.tween(tile, {
      y: tile.y + REMOVAL_DROP,
      alpha: 0,
      duration,
      ease: 'power2.in',
      onComplete: () => {
        // 这一格上还挂着另一条缩放补间，格子里的卡和角标也各有各的，所以整棵子树一起掐。
        killAndDestroy(this.deps.animator, tile)
        this.layoutRow(side)
      },
    })
    this.deps.animator.tween(tile.scale, { x: 0.86, y: 0.86, duration, ease: 'power2.in' })
    return REMOVAL_FX_MS
  }

  /**
   * 进化：换一张脸，同时弹一下、亮一圈绿光、升起一行浮字。
   *
   * 三样同时起、各演各的时长（弹 0.42、辉光 0.7、浮字 0.9），整段按最长的浮字算——
   * 和 timings 里 `EVOLVE_FX_MS` 的算法一致，那条常量的注释写着同一件事。
   * `order` 是这一批里的第几个，用来错开起跑（同一轮可能好几个单位一起进化）。
   * 返回旧的那张卡，调用方负责销毁。
   */
  transform(instanceId: string, card: CardSprite, order = 0): CardSprite | null {
    const entry = this.tiles.get(instanceId)
    if (entry === undefined) return null
    const { tile } = entry
    const previous = tile.swapCard(card)
    const delay = (order * EVOLVE_STAGGER_MS) / 1000
    const { animator } = this.deps

    animator.fromTo(
      tile.scale,
      { x: 1, y: 1 },
      {
        x: EVOLVE.popScale,
        y: EVOLVE.popScale,
        duration: EVOLVE.popDur / 2,
        delay,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
      },
    )
    /*
     * 特效画在 fxLayer 上，而那一层是战场的直接子节点；格子的坐标却是相对**它那一排**的。
     * 所以要过一次换算再摆——`tileAt` 已经把排的偏移算进去了。
     */
    const at = this.tileAt(instanceId)
    if (at !== null) {
      this.playEvolveGlow(at, tile.boxWidth, tile.boxHeight, delay)
      this.playEvolveLabel(at, tile.boxHeight, delay)
    }
    return previous
  }

  /**
   * 简易进场（`pop-in`）：那张卡从六成大小弹到原大，同时淡入。
   *
   * 只有强制展示受理不了时才走这一条——那时对手的牌没有"从手里飞出来"的过程，
   * 是凭空出现在格子里的，弹一下是为了让人看出这一格是刚多出来的。
   * 格子的原点在自己中心（见 BoardTile），所以缩放是从中间涨开而不是往一角塌。
   * 返回时长（毫秒），和 cue 里的 `durationMs` 是同一个数。
   */
  popIn(instanceId: string): number {
    const entry = this.tiles.get(instanceId)
    if (entry === undefined) return 0
    const { tile } = entry
    const duration = POP_IN_MS / 1000
    const { animator } = this.deps
    animator.fromTo(
      tile,
      { alpha: 0 },
      { alpha: 1, duration, ease: POP_IN.ease, overwrite: 'auto' },
    )
    animator.fromTo(
      tile.scale,
      { x: POP_IN.fromScale, y: POP_IN.fromScale },
      { x: 1, y: 1, duration, ease: POP_IN.ease, overwrite: 'auto' },
    )
    return POP_IN_MS
  }

  /**
   * 当场清空整个战场，不播任何演出。
   *
   * 和 `remove` 是两回事：那个是「这一格被罚下了」，要演一段沉下去化掉；
   * 这个是「换一局」——上一局的场面不该演一遍退场，它压根不该再出现。
   */
  clear(): void {
    for (const { tile } of this.tiles.values()) killAndDestroy(this.deps.animator, tile)
    this.tiles.clear()
  }

  /** 挂哪几枚状态角标。文案表归场景查（旧版在 ui/tileMarks.ts），这里只管画。 */
  setMark(instanceId: string, marks: readonly TileMark[]): void {
    this.tiles.get(instanceId)?.tile.setMarks(marks)
  }

  /** 亮起这一批格子的橙圈，其余的关掉。传空数组等于 `clearTargets`。 */
  highlightTargets(ids: readonly string[]): void {
    const wanted = new Set(ids)
    for (const [id, entry] of this.tiles) entry.tile.setTargetable(wanted.has(id))
  }

  /** 全部关掉。 */
  clearTargets(): void {
    this.highlightTargets([])
  }

  /** 某个格子的中心（战场自己的坐标）和尺寸。飞行动画拿它当落点，命中特效拿它定范围。 */
  tileAt(instanceId: string): { x: number; y: number; width: number; height: number } | null {
    const entry = this.tiles.get(instanceId)
    if (entry === undefined) return null
    const { tile, side } = entry
    const row = this.rows[side]
    return {
      x: row.x + tile.x,
      y: row.y + tile.y,
      width: tile.boxWidth,
      height: tile.boxHeight,
    }
  }

  /** 拿到某个格子本身（要藏起来、要换角标、要对着它播特效时用）。 */
  tile(instanceId: string): BoardTile | null {
    return this.tiles.get(instanceId)?.tile ?? null
  }

  /**
   * 现在场上有哪几格，按放上去的先后排。
   *
   * 场景拿它和局面对账：视图里已经没有、这里还留着的那几格说明有单位下场了
   *（见 scenes/duel/applyView.ts）。罚下那一段演着的时候格子已经不在这份名单里了——
   * `remove` 是当场从表里划掉、只把动画留到后面演的。
   */
  ids(): string[] {
    return [...this.tiles.keys()]
  }

  /** 中线正中那枚徽章上印什么（「第 3 轮 · 轮到你出牌」）。传 null 就不挂。 */
  setTurnBadge(text: string | null): void {
    for (const child of this.badgeSlot.removeChildren()) killAndDestroy(this.deps.animator, child)
    if (text !== null) {
      // 字面量 'E' 就是 BADGE_TURN（中线回合徽章）：Badge 的选项是按变体分支的联合类型，
      // 传变量会丢掉分支信息，所以这里和别的调用方一样写字面量。
      const badge = new Badge({ variant: 'E', text }, this.deps)
      badge.position.set((this.boxWidth - badge.boxWidth) / 2, -badge.boxHeight / 2)
      this.badgeSlot.addChild(badge)
    }
    this.badgeSlot.y = this.boxHeight / 2
  }

  /** 中线要给徽章让出多宽。徽章还没挂时让 0，线就是完整的一条。 */
  private badgeGap(): number {
    const badge = this.badgeSlot.children[0]
    return badge === undefined ? 0 : badge.width + MIDLINE_MARGIN * 4
  }

  /**
   * 两排各占一半高，中线压在正中。
   *
   * 两排的原点都放在**战场横向的正中**：格子是按「离中心多远」排的（见 layoutRow），
   * 原点留在左上角的话整排会往左跑出去一半。
   */
  private layout(): void {
    const half = this.boxHeight / 2
    const centerX = this.boxWidth / 2
    this.rows.opponent.position.set(centerX, half / 2 - MIDLINE_MARGIN)
    this.rows.self.position.set(centerX, half + half / 2 + MIDLINE_MARGIN)
    this.midline.position.set(0, half)
    this.badgeSlot.y = half
    this.layoutRow('opponent')
    this.layoutRow('self')
  }

  /**
   * 一排里的格子从左到右居中排开。
   *
   * 间距先按理想的 `SLOT_STEP` 取，装不下就压到「刚好铺满可用宽度」，
   * 再被 `MIN_GAP` 兜住下限——那一档下相邻两张已经互相压边，但每张至少还露 12px。
   */
  private layoutRow(side: BoardSide): void {
    const row = this.rows[side]
    const tiles = row.children as BoardTile[]
    if (tiles.length === 0) return
    const tileWidth = tiles[0]!.boxWidth
    const ideal = tileWidth * SLOT_STEP
    const fit = tiles.length <= 1 ? ideal : (this.boxWidth - tileWidth) / (tiles.length - 1)
    const step = Math.max(MIN_GAP, Math.min(ideal, fit))
    tiles.forEach((tile, index) => {
      tile.x = (index - (tiles.length - 1) / 2) * step
      tile.y = 0
    })
  }

  /**
   * 进化时那圈绿光：贴着格子轮廓画三圈由内到外越来越淡的描边，整体淡入再淡出。
   *
   * 旧版是一层 `box-shadow` 的绿色外发光，那在 Pixi 里只能靠滤镜或一张烤好的软边纹理，
   * 前者 3.1 不许，后者要为每种格子尺寸各烤一张。三圈递减的描边是同一种「越往外越淡」的读法，
   * 而且只画一次几何、之后只改 alpha（3.10）。
   */
  private playEvolveGlow(
    at: { x: number; y: number },
    width: number,
    height: number,
    delay: number,
  ): void {
    const glow = new Graphics()
    for (let ring = 0; ring < 3; ring += 1) {
      const spread = 2 + ring * 4
      const w = width + spread * 2
      const h = height + spread * 2
      glow
        .roundRect(-w / 2, -h / 2, w, h, tokens.radius.md + spread)
        .stroke({ width: 3, color: tokens.color.mark.up.line, alpha: 0.5 - ring * 0.15 })
    }
    glow.position.set(at.x, at.y)
    glow.alpha = 0
    this.fxLayer.addChild(glow)
    this.deps.animator
      .timeline({ delay, onComplete: () => glow.destroy() })
      .to(glow, { alpha: 1, duration: EVOLVE.glowDur * 0.3, ease: 'power2.out' })
      .to(glow, { alpha: 0, duration: EVOLVE.glowDur * 0.7, ease: 'power2.in' })
  }

  /**
   * 「↑ 升级」浮字：从格子上沿升起 34px，边升边淡出。
   * 它是这一批里最长的一样（0.9 秒），所以整段进化的时长就按它算，见 EVOLVE_FX_MS。
   */
  private playEvolveLabel(at: { x: number; y: number }, height: number, delay: number): void {
    const label = new Label('↑ 升级', EVOLVE_LABEL, this.deps, tokens.color.mark.up.ink)
    const startY = at.y - height / 2
    label.position.set(at.x, startY)
    label.alpha = 0
    this.fxLayer.addChild(label)
    const total = EVOLVE_FX_MS / 1000
    const timeline = this.deps.animator.timeline({
      delay,
      onComplete: () => label.destroy({ children: true }),
    })
    timeline.to(label, { y: startY - EVOLVE.labelRise, duration: total, ease: 'power2.out' }, 0)
    timeline.to(label, { alpha: 1, duration: total * 0.2, ease: 'power2.out' }, 0)
    timeline.to(label, { alpha: 0, duration: total * 0.4, ease: 'power2.in' }, total * 0.6)
  }
}
