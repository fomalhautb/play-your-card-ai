/**
 * 对局场景的零件表：建出全部组件、分好层，并按版式把它们摆到位。
 *
 * 只做「摆」这一件事，不认识 cue 也不认识局面——谁在什么时候演什么归 cuePlayers/，
 * 手里有几张牌归 applyView.ts。拆出来是因为「有哪些组件、它们叠在第几层」
 * 是读这个场景时第一个要回答的问题，混在演出逻辑里就得靠翻找拼出来。
 *
 * 层序（自下而上）：
 *   worldRoot   战场 → 对手手牌 → 界面框架（顶栏 / 侧栏 / 按钮）→ 特效 → 我方手牌 → 拖拽层
 *   overlayRoot 选目标 → 展示层 → 抛硬币 / 抵消层 / 结算层 → 横幅 → 提示气泡（指令被拒的红字）
 * 震屏抖的是 worldRoot：全屏过场和展示层不该跟着抖，抖了就不像「战场被砸了一下」。
 *
 * 全屏半透明层同屏不超过三层（纪律 3.2）：抛硬币、抵消层、展示遮罩、结算层、选目标压暗
 * 五者由编排层保证不会同时立起来（见 director/reveal.ts 那四道门），场景这边也不叠。
 *
 * 正式版简化第 4 步之二之后，界面那一层几乎全是素方块（见 components/Box.ts）：
 * 侧栏外框、战场外框、落点提示、「下一题」匾、「结束出牌」都是这里直接建的 `Box`，
 * 不再各有一个带底图和配色的组件。两块玩家面板在**两档里都由这里摆**——
 * 从前桌面档是塞进 `SideBar` 里由它算，那等于把版式分散到了两处。
 */

import { Container, type Renderer } from 'pixi.js'
import { Banner } from '../../components/Banner'
import { BoardGrid } from '../../components/BoardGrid'
import { Box } from '../../components/Box'
import { CoinToss } from '../../components/CoinToss'
import { FoeHand } from '../../components/FoeHand'
import { HandFan } from '../../components/HandFan'
import { PlayerPanel } from '../../components/PlayerPanel'
import { RevealOverlay } from '../../components/RevealOverlay'
import { SettleLayer } from '../../components/SettleLayer'
import { SkillCancelLayer } from '../../components/SkillCancelLayer'
import { TargetingLayer } from '../../components/TargetingLayer'
import { TokenRail } from '../../components/TokenRail'
import { TopBar } from '../../components/TopBar'
import { TurnPlaque } from '../../components/TurnPlaque'
import { HitFx } from '../../fx/HitFx'
import { PLAYER_FAN } from '../../layout/fanMath'
import type { DuelDeps } from './deps'
import { createDropCues, type DropCues, placeDropCues } from './dropCue'
import type { DuelLayout, Rect } from './layout/types'

/**
 * 手机档那一行面板里英雄牌四周留多宽。
 *
 * 桌面档留 0：那一档面板 266×373.5，英雄牌按 2:3 填满正好是黑客松版的 249×373.5。
 * 手机档那一行只有 96 高，卡贴着框边会和名字那一格糊在一起。
 */
const MOBILE_CARD_INSET = 22

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
  /** 桌面档侧栏那一圈外框。手机档没有侧栏，这里是 null。 */
  sideBar: Box | null
  /** 两块玩家面板。两档都有，位置由版式给。 */
  panels: { mine: PlayerPanel; theirs: PlayerPanel }
  /** Token 细条。桌面档贴舞台右缘自己站着，手机档挂在我方面板里（这里是 null）。 */
  tokenRail: TokenRail | null
  /** 「下一题」匾。手机档折叠掉了。 */
  nextPlaque: Box | null
  /** 「对方回合」吊匾。手机档没有。 */
  turnPlaque: TurnPlaque | null
  /** 拖着牌时才亮的那几块提示：战场外框、加粗圈、两句话、取消区（见 dropCue.ts）。 */
  drop: DropCues
  board: BoardGrid
  foeHand: FoeHand
  fan: HandFan
  /** 「结束出牌」。等对方出牌时整颗收起来（由 input.refresh 按 `waitingForFoe` 切）。 */
  endPlay: Box
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
  onEndPlay: () => void
  onLeave?: () => void
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

/** 一块只画描边、不吃事件的方块。侧栏外框、战场外框这几样都是它。 */
function frameBox(rect: Rect, deps: DuelDeps): Box {
  const box = new Box({ width: rect.width, height: rect.height }, deps)
  box.position.set(rect.x, rect.y)
  box.eventMode = 'none'
  return box
}

/** 建出全部组件并挂到各自的层上。摆位不在这里，建完立刻由 `applyPartsLayout` 摆一次。 */
export function createParts(options: PartsOptions): DuelParts {
  const { deps, layout } = options
  const layers = makeLayers(options.stage)
  const desktop = layout.tier === 'desktop'

  const topBar = new TopBar(
    { width: layout.width, height: layout.topBarHeight, onLeave: options.onLeave },
    deps,
  )
  const sideBar = layout.sideBar === null ? null : frameBox(layout.sideBar, deps)
  const panels = {
    theirs: new PlayerPanel(
      {
        width: layout.panels.theirs.width,
        height: layout.panels.theirs.height,
        cardInset: desktop ? 0 : MOBILE_CARD_INSET,
        ...(desktop ? { deckSide: 'top' as const } : {}),
      },
      deps,
    ),
    mine: new PlayerPanel(
      {
        width: layout.panels.mine.width,
        height: layout.panels.mine.height,
        cardInset: desktop ? 0 : MOBILE_CARD_INSET,
        // 手机档没有贴边的地方，细条只能挂在面板里；桌面档它自己站在舞台右缘。
        tokens: !desktop,
        ...(desktop ? { deckSide: 'bottom' as const } : {}),
      },
      deps,
    ),
  }
  const tokenRail = layout.tokenRail === null ? null : new TokenRail(deps)
  const nextPlaque = layout.nextPlaque === null ? null : frameBox(layout.nextPlaque, deps)
  const turnPlaque =
    layout.turnPlaque === null
      ? null
      : new TurnPlaque({ width: layout.turnPlaque.width, height: layout.turnPlaque.height }, deps)

  const drop = createDropCues(layout, deps)

  const board = new BoardGrid(
    {
      width: layout.board.width / layout.board.scale,
      height: layout.board.height / layout.board.scale,
    },
    deps,
  )
  /*
   * 对手那排用的是**烤出来的隐藏牌背**（纸白底 + 内圈细边 + 藏青纹章），不是自己人那张美术卡背：
   * 把对方的牌背画成和我方一样，等于告诉玩家「那是张 AI 牌还是技能牌」。
   * 强制展示那张卡起飞时用的也是同一张（见 cuePlayers/reveal.ts），两处必须一致才不跳变。
   */
  const foeHand = new FoeHand(
    { areaWidth: layout.foeHand.areaWidth },
    { ...deps, back: deps.baked.foeBack },
  )
  const fan = new HandFan({
    animator: deps.animator,
    geometry: PLAYER_FAN,
    areaWidth: layout.hand.areaWidth,
  })
  const endPlay = new Box(
    { width: layout.endPlay.width, height: layout.endPlay.height, label: '结束出牌' },
    deps,
  )
  endPlay.onPress(options.onEndPlay)
  /*
   * 在场景树上给它留个名字。
   *
   * 素方块是通用原语，一块方块是干什么的只有装配处知道，所以名字在这里给。
   * 真浏览器的交互回归靠它找到「按哪儿」（bench 的 src/page/hitPoints.ts），
   * 命名跟卡（`card:`）和格子（`tile:`）一个路子。
   */
  endPlay.label = 'button:end-play'

  const banner = new Banner(deps)
  const coin = new CoinToss(deps)
  const cancel = new SkillCancelLayer(deps)
  const reveal = new RevealOverlay(
    { scale: layout.revealScale, anchorY: 0.46, topClip: layout.topBarHeight },
    deps,
  )
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
    reducedMotion: deps.reducedMotion,
  })

  // 战场外框垫在格子底下，落点提示和「加粗」那一圈压在格子上面（它们要盖住的正是格子那一带）。
  // 外框垫在格子底下，加粗圈和提示压在格子上面（它们要盖住的正是格子那一带）。
  layers.board.addChild(drop.boardFrame, board, drop.hotRing)
  if (drop.boardCue !== null) layers.board.addChild(drop.boardCue)
  // 取消区排在手牌**之前**：它只是底下那条框，不该盖住牌。
  layers.hand.addChildAt(drop.returnZone, 0)
  layers.hand.addChildAt(drop.returnCue, 1)
  layers.foeHand.addChild(foeHand)
  layers.chrome.addChild(topBar, endPlay, panels.theirs, panels.mine)
  if (sideBar !== null) layers.chrome.addChildAt(sideBar, 0)
  if (tokenRail !== null) layers.chrome.addChild(tokenRail)
  if (nextPlaque !== null) layers.chrome.addChild(nextPlaque)
  if (turnPlaque !== null) layers.chrome.addChild(turnPlaque)
  layers.hand.addChild(fan)
  layers.overlay.addChild(targeting, reveal, coin, cancel, settle, banner)

  const parts: DuelParts = {
    layers,
    topBar,
    sideBar,
    panels,
    tokenRail,
    nextPlaque,
    turnPlaque,
    drop,
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

/**
 * 按版式把所有零件摆一遍。改视口和换档位都走这里。
 *
 * 换档位（桌面 ↔ 手机）时有没有侧栏、细条、两块吊匾都会变，那种情况由场景整个重建零件，
 * 这里只处理**同一档内**的尺寸变化。
 */
export function applyPartsLayout(parts: DuelParts, layout: DuelLayout): void {
  parts.topBar.resize(layout.width, layout.topBarHeight)
  parts.topBar.position.set(0, 0)

  place(parts.sideBar, layout.sideBar)
  for (const side of ['theirs', 'mine'] as const) {
    const rect = layout.panels[side]
    parts.panels[side].resize(rect.width, rect.height)
    parts.panels[side].position.set(rect.x, rect.y)
  }
  if (parts.tokenRail !== null && layout.tokenRail !== null) {
    parts.tokenRail.position.set(layout.tokenRail.x, layout.tokenRail.y)
  }
  place(parts.nextPlaque, layout.nextPlaque)
  if (parts.turnPlaque !== null && layout.turnPlaque !== null) {
    parts.turnPlaque.resize(layout.turnPlaque.width, layout.turnPlaque.height)
    parts.turnPlaque.position.set(layout.turnPlaque.x, layout.turnPlaque.y)
  }

  placeDropCues(parts.drop, layout)

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

  parts.endPlay.setSize(layout.endPlay.width, layout.endPlay.height)
  parts.endPlay.position.set(layout.endPlay.x, layout.endPlay.y)

  parts.banner.position.set(layout.banner.x, layout.banner.y)
  parts.coin.resize(layout.width, layout.height)
  parts.cancel.resize(layout.width, layout.height)
  parts.reveal.resize(layout.width, layout.height)
  parts.targeting.resize(layout.width, layout.height)
  parts.settle.resize(layout.width, layout.height)
}

/** 把一块方块按矩形摆好。两边只要有一个是 null 就说明这一档没有这样东西。 */
function place(box: Box | null, rect: Rect | null): void {
  if (box === null || rect === null) return
  box.setSize(rect.width, rect.height)
  box.position.set(rect.x, rect.y)
}
