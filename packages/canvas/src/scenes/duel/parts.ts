/**
 * 对局场景的零件表：建出全部组件、分好层，并按版式把它们摆到位。
 *
 * 只做「摆」这一件事，不认识 cue 也不认识局面——谁在什么时候演什么归 cuePlayers/，
 * 手里有几张牌归 applyView.ts。拆出来是因为「有哪些组件、它们叠在第几层」
 * 是读这个场景时第一个要回答的问题，混在演出逻辑里就得靠翻找拼出来。
 *
 * 层序（自下而上）：
 *   worldRoot   战场 → 对手手牌 → 界面框架（顶栏 / 侧栏 / 按钮）→ 特效 → 我方手牌 → 拖拽层
 *   overlayRoot 选目标 → 展示层 → 抛硬币 / 抵消层 / 结算层 → 横幅 → 提示气泡
 * 震屏抖的是 worldRoot：全屏过场和展示层不该跟着抖，抖了就不像「战场被砸了一下」。
 *
 * 全屏半透明层同屏不超过三层（纪律 3.2）：抛硬币、抵消层、展示遮罩、结算层、选目标压暗
 * 五者由编排层保证不会同时立起来（见 director/reveal.ts 那四道门），场景这边也不叠。
 */

import { Container, type Renderer } from 'pixi.js'
import { Banner } from '../../components/Banner'
import { BoardGrid } from '../../components/BoardGrid'
import { CoinToss } from '../../components/CoinToss'
import { FoeHand } from '../../components/FoeHand'
import { HandFan } from '../../components/HandFan'
import { PLAQUE_TERRACOTTA, PlaqueButton } from '../../components/PlaqueButton'
import { PlayerPanel } from '../../components/PlayerPanel'
import { RevealOverlay } from '../../components/RevealOverlay'
import { SettleLayer } from '../../components/SettleLayer'
import { SideBar } from '../../components/SideBar'
import { SkillCancelLayer } from '../../components/SkillCancelLayer'
import { TargetingLayer } from '../../components/TargetingLayer'
import { TopBar } from '../../components/TopBar'
import { HitFx } from '../../fx/HitFx'
import { PLAYER_FAN } from '../../layout/fanMath'
import type { DuelDeps } from './deps'
import type { DuelLayout } from './layout/types'
import type { DuelIcons } from './placeholderIcons'

interface DuelLayers {
  world: Container
  board: Container
  foeHand: Container
  chrome: Container
  fx: Container
  hand: Container
  drag: Container
  overlay: Container
  bubble: Container
}

export interface DuelParts {
  layers: DuelLayers
  topBar: TopBar
  /** 桌面档才有。手机档这里是 null，两块面板改挂在 `panelRow` 那一行上。 */
  sideBar: SideBar | null
  /** 不管哪一档都指得到的两块玩家面板：桌面档是侧栏里的那两块，手机档是独立的两块。 */
  panels: { mine: PlayerPanel; theirs: PlayerPanel }
  board: BoardGrid
  foeHand: FoeHand
  fan: HandFan
  endPlay: PlaqueButton
  banner: Banner
  coin: CoinToss
  cancel: SkillCancelLayer
  reveal: RevealOverlay
  targeting: TargetingLayer
  settle: SettleLayer
  hitFx: HitFx
}

export interface PartsOptions {
  stage: Container
  renderer: Renderer
  deps: DuelDeps
  layout: DuelLayout
  icons: DuelIcons
  onEndPlay: () => void
  onLeave?: () => void
  onToggleMute?: () => void
}

function makeLayers(stage: Container): DuelLayers {
  const world = new Container()
  const overlay = new Container()
  const layers: DuelLayers = {
    world,
    board: new Container(),
    foeHand: new Container(),
    chrome: new Container(),
    fx: new Container(),
    hand: new Container(),
    drag: new Container(),
    overlay,
    bubble: new Container(),
  }
  world.addChild(layers.board, layers.foeHand, layers.chrome, layers.fx, layers.hand, layers.drag)
  stage.addChild(world, overlay, layers.bubble)
  // 特效层和对手手牌只是画面，吃了指针事件下面的牌就点不着了。
  layers.fx.eventMode = 'none'
  layers.foeHand.eventMode = 'none'
  layers.bubble.eventMode = 'none'
  return layers
}

/** 建出全部组件并挂到各自的层上。摆位不在这里，建完立刻由 `applyPartsLayout` 摆一次。 */
export function createParts(options: PartsOptions): DuelParts {
  const { deps, layout } = options
  const layers = makeLayers(options.stage)

  const topBar = new TopBar(
    {
      width: layout.width,
      height: layout.topBarHeight,
      // 手机档不摆右端那两颗钮，理由见 TopBarOptions.actions。
      actions: layout.tier === 'desktop',
      onLeave: options.onLeave,
      onToggleMute: options.onToggleMute,
    },
    { ...deps, icons: options.icons },
  )
  const sideBar =
    layout.sideBar === null
      ? null
      : new SideBar({ width: layout.sideBar.width, height: layout.sideBar.height }, deps)
  const panels =
    sideBar === null
      ? standalonePanels(deps, layout)
      : { mine: sideBar.mine, theirs: sideBar.theirs }

  const board = new BoardGrid(
    {
      width: layout.board.width / layout.board.scale,
      height: layout.board.height / layout.board.scale,
    },
    deps,
  )
  const foeHand = new FoeHand({ areaWidth: layout.foeHand.areaWidth }, { ...deps, back: deps.back })
  const fan = new HandFan({
    animator: deps.animator,
    geometry: PLAYER_FAN,
    areaWidth: layout.hand.areaWidth,
  })
  const endPlay = new PlaqueButton(
    {
      variant: PLAQUE_TERRACOTTA,
      caption: '结束出牌',
      size: 'endTurn',
      onActivate: options.onEndPlay,
    },
    deps,
  )
  /*
   * 在场景树上给它留个名字。
   *
   * PlaqueButton 是通用组件，一颗按钮是干什么的只有装配处知道，所以名字在这里给。
   * 真浏览器的交互回归靠它找到「按哪儿」（bench 的 src/page/hitPoints.ts），
   * 命名跟卡（`card:`）和格子（`tile:`）一个路子。
   */
  endPlay.label = 'button:end-play'

  const banner = new Banner(deps)
  const coin = new CoinToss(deps)
  const cancel = new SkillCancelLayer(deps)
  const reveal = new RevealOverlay({ scale: layout.revealScale }, deps)
  const targeting = new TargetingLayer(deps)
  const settle = new SettleLayer(layout.width, layout.height, deps)

  const hitFx = new HitFx({
    layer: layers.fx,
    // 震屏抖整个 worldRoot，和旧版抖 `.battle` 根元素同一个口径。
    shakeTarget: layers.world,
    animator: deps.animator,
    baked: deps.baked,
    rng: deps.rng,
    tier: deps.tier,
  })

  layers.board.addChild(board)
  layers.foeHand.addChild(foeHand)
  layers.chrome.addChild(topBar, endPlay)
  if (sideBar !== null) layers.chrome.addChild(sideBar)
  else layers.chrome.addChild(panels.theirs, panels.mine)
  layers.hand.addChild(fan)
  layers.overlay.addChild(targeting, reveal, coin, cancel, settle, banner)

  const parts: DuelParts = {
    layers,
    topBar,
    sideBar,
    panels,
    board,
    foeHand,
    fan,
    endPlay,
    banner,
    coin,
    cancel,
    reveal,
    targeting,
    settle,
    hitFx,
  }
  applyPartsLayout(parts, layout)
  return parts
}

/** 手机档：侧栏折叠掉之后，两块面板自己站着。我方那块仍然带 Token 细条。 */
function standalonePanels(
  deps: DuelDeps,
  layout: DuelLayout,
): { mine: PlayerPanel; theirs: PlayerPanel } {
  const size = panelRowSize(layout)
  return {
    theirs: new PlayerPanel(size, deps),
    mine: new PlayerPanel({ ...size, tokens: true }, deps),
  }
}

/** 折叠那一行里每块面板多大。两块平分，中间留一个空隙。 */
function panelRowSize(layout: DuelLayout): { width: number; height: number } {
  const row = layout.panelRow
  if (row === null) return { width: 0, height: 0 }
  return { width: Math.max(0, (row.width - row.gap) / 2), height: row.height }
}

/**
 * 按版式把所有零件摆一遍。改视口和换档位都走这里。
 *
 * 换档位（桌面 ↔ 手机）时侧栏是有还是没有会变，那种情况由场景整个重建零件，
 * 这里只处理**同一档内**的尺寸变化。
 */
export function applyPartsLayout(parts: DuelParts, layout: DuelLayout): void {
  parts.topBar.resize(layout.width, layout.topBarHeight)
  parts.topBar.position.set(0, 0)

  if (parts.sideBar !== null && layout.sideBar !== null) {
    parts.sideBar.resize(layout.sideBar.width, layout.sideBar.height)
    parts.sideBar.position.set(layout.sideBar.x, layout.sideBar.y)
  } else if (layout.panelRow !== null) {
    const size = panelRowSize(layout)
    const row = layout.panelRow
    parts.panels.theirs.resize(size.width, size.height)
    parts.panels.mine.resize(size.width, size.height)
    parts.panels.theirs.position.set(row.x, row.y)
    parts.panels.mine.position.set(row.x + size.width + row.gap, row.y)
  }

  parts.board.resize(
    layout.board.width / layout.board.scale,
    layout.board.height / layout.board.scale,
  )
  parts.board.position.set(layout.board.x, layout.board.y)
  parts.board.scale.set(layout.board.scale)

  parts.foeHand.setAreaWidth(layout.foeHand.areaWidth)
  parts.foeHand.position.set(layout.foeHand.x, layout.foeHand.y)

  parts.fan.setAreaWidth(layout.hand.areaWidth)
  parts.fan.position.set(layout.hand.x, layout.hand.y)
  parts.fan.scale.set(layout.hand.scale)

  parts.endPlay.position.set(
    layout.endPlay.x - parts.endPlay.boxWidth / 2,
    layout.endPlay.y - parts.endPlay.boxHeight / 2,
  )

  parts.banner.position.set(layout.width / 2, layout.height * 0.24)
  parts.coin.resize(layout.width, layout.height)
  parts.cancel.resize(layout.width, layout.height)
  parts.reveal.resize(layout.width, layout.height)
  parts.targeting.resize(layout.width, layout.height)
  parts.settle.resize(layout.width, layout.height)
}
