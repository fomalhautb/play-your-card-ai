/**
 * 桌面档版式：一块 1672×941 的死版式，整块等比缩放居中放进视口。
 *
 * 数全部照黑客松版的 `styles.css` 来（正式版简化第 4 步之二把这一档还原成那一版）：
 * 舞台 1672×941、顶栏 72、侧栏 306、战场外框 334/156/1310×535 内边距 52/24/18、
 * Token 细条贴右缘、「下一题」匾吊在战场右上、「结束出牌」压在手牌区右下角。
 * 改任何一个数之前先回去核对那份样式表——这一档的每一行都对得上它的一条规则。
 *
 * 为什么回到死版式：这一页的每一块都是照 1672×941 量的（扇形可铺宽依赖「结束出牌」的左沿、
 * 战场高度预算依赖两排格子加中线正好用完 465），按真实视口实算的话这些关系要各自重新推一遍，
 * 而窗口比例一变就又对不上。整块缩放只写一个 transform，反而是最省事也最不会走样的做法。
 *
 * 和手机档的关系是**并列**，不是缩放：那边侧栏折叠成一行、战场整块缩小、手牌区更高，
 * 三处都在 mobileLayout.ts 里独立算（需求第 3 条）。
 */

import { tokens } from '@ai-duel/design'
import { CARD_HEIGHT } from '../../../layout/fanMath'
import { type DuelLayout, deckPileRectOf, fitBoardScale, heroCardRectOf, type Rect } from './types'

/** 设计稿尺寸。黑客松版 `ui/battleStage.ts` 的 `BATTLE_STAGE_WIDTH / HEIGHT`。 */
export const DESIGN_WIDTH = 1672
export const DESIGN_HEIGHT = 941

/** 战场上下让给对手手牌和我方手牌的高度。`.battle__battlefield` 的两个自定义属性。 */
const FOE_ZONE = tokens.size.battle.foeHandHeight
const HAND_ZONE = tokens.size.battle.handZoneHeight

/** 战场外框离左右两边留多宽。`.battle__board` 的 `inset: 84px 28px 250px` 里那个 28。 */
const FIELD_PAD_X = 28

/**
 * 战场外框的内边距：上 52、左右 24、下 18。
 *
 * 顶上那 52 不是留白，是给拖拽时的落点提示（`.battle__drop-cue--board`）让位的。
 * 剩下的 465 高正好装下两排 165 的格子加 30 的中线，富余摊给两行的行内居中。
 */
const BOARD_PAD = { top: 52, x: 24, bottom: 18 } as const

/** 落点提示那颗药丸的尺寸和它离外框顶边多远。抄 `.battle__drop-cue`（min-width 154、top 14）。 */
const DROP_CUE = { width: 154, height: 37, top: 14 } as const

/** 侧栏内边距和两块面板之间那一档。抄雕花框内容区的 `padding: 40px 20px` 和 `gap: 16px`。 */
const SIDE_PAD = { x: 20, y: 40 } as const
const PANEL_GAP = 16
/** 两块面板中间那条分隔线占的高。抄 `.battle__player-divider` 的 10px。 */
const PANEL_DIVIDER = 10

/** 「下一题」匾：宽 168，连吊绳一共 144 高，右边沿离舞台右缘 56。抄 `.battle__next-plaque`。 */
const NEXT_PLAQUE = { right: 56 } as const

/** 「结束出牌」离舞台右下角多远。抄 `.battle__end-turn` 的 `right: 32; bottom: 32`。 */
const END_PLAY_INSET = 32

/** 扇形最外侧那张牌和障碍物之间至少留出的空隙，以及被拒红字离手牌区上沿多远。 */
const BUBBLE_GAP = 28

/** 「对方回合」吊匾从顶栏下沿垂下来的绳长。抄 `.battle__turn-plaque-cords` 的 21px。 */
const TURN_PLAQUE_CORD = tokens.size.turnPlaque.cordLength

export function desktopLayout(viewWidth: number, viewHeight: number): DuelLayout {
  const width = DESIGN_WIDTH
  const height = DESIGN_HEIGHT
  const scale = Math.min(viewWidth / width, viewHeight / height)

  const topBarHeight = tokens.size.battle.topbarHeight
  const sideWidth = tokens.size.battle.sidebarWidth
  const sideBar = { x: 0, y: topBarHeight, width: sideWidth, height: height - topBarHeight }
  const panels = panelRects(sideBar)

  const fieldX = sideWidth
  const fieldWidth = width - sideWidth

  const boardFrame = {
    x: fieldX + FIELD_PAD_X,
    y: topBarHeight + FOE_ZONE,
    width: fieldWidth - FIELD_PAD_X * 2,
    height: height - topBarHeight - FOE_ZONE - HAND_ZONE,
  }
  const board = {
    x: boardFrame.x + BOARD_PAD.x,
    y: boardFrame.y + BOARD_PAD.top,
    width: boardFrame.width - BOARD_PAD.x * 2,
    height: boardFrame.height - BOARD_PAD.top - BOARD_PAD.bottom,
  }

  const endPlay = {
    x: width - END_PLAY_INSET - tokens.size.plaque.endTurnWidth,
    y: height - END_PLAY_INSET - tokens.size.plaque.endTurnHeight,
    width: tokens.size.plaque.endTurnWidth,
    height: tokens.size.plaque.endTurnHeight,
  }

  /*
   * 扇形以锚点中线为轴对称摊开，所以可铺宽是「中线到左右两个障碍物的距离」取小的那个再翻倍：
   * 左边是整条不透明的侧栏（战场左沿就是它的右沿），右边是压在手牌区里的「结束出牌」。
   * 设计尺寸下右侧是窄的那边——中线 989 到侧栏 306 有 683，到按钮左沿 1456 只有 467，
   * 于是可铺宽是 934。黑客松版是运行时量 DOM 量出来的同一个数（HandFan 的 fanAreaWidth）。
   */
  const fanCenterX = fieldX + fieldWidth / 2
  const hand = {
    x: fanCenterX,
    y: height,
    // 舞台已经整块缩放过了，扇形自己不再缩一次——两处各缩一次就是缩了两遍。
    scale: 1,
    areaWidth: 2 * Math.min(fanCenterX - sideWidth, endPlay.x - fanCenterX),
  }

  return {
    tier: 'desktop',
    width,
    height,
    viewport: { width: viewWidth, height: viewHeight },
    stage: { scale, x: (viewWidth - width * scale) / 2, y: (viewHeight - height * scale) / 2 },
    topBarHeight,
    sideBar,
    panels,
    boardFrame,
    board: { ...board, scale: fitBoardScale(board.width, board.height) },
    dropCue: {
      x: boardFrame.x + (boardFrame.width - DROP_CUE.width) / 2,
      y: boardFrame.y + DROP_CUE.top,
      width: DROP_CUE.width,
      height: DROP_CUE.height,
    },
    tokenRail: {
      x: width - tokens.size.rail.width,
      y: (height - tokens.size.rail.height) / 2,
      width: tokens.size.rail.width,
      height: tokens.size.rail.height,
    },
    nextPlaque: {
      x: width - NEXT_PLAQUE.right - tokens.size.nextPlaque.width,
      y: topBarHeight,
      width: tokens.size.nextPlaque.width,
      height: tokens.size.nextPlaque.height + tokens.size.nextPlaque.cordLength,
    },
    turnPlaque: {
      x: fanCenterX - tokens.size.turnPlaque.width / 2,
      y: topBarHeight + TURN_PLAQUE_CORD,
      width: tokens.size.turnPlaque.width,
      height: tokens.size.turnPlaque.height,
    },
    /*
     * 对手那排钉在舞台顶边（y=0），上半截被不透明的顶栏压住，每张只露出约 72px。
     * 可铺宽给的是**战场那一栏的宽**：黑客松版按这个宽算完扇形，再把每张的 x 乘上 0.64
     *（FoeHand 的容器缩放干的就是这件事），所以传进去的正是没乘之前的那个数。
     */
    foeHand: { x: fanCenterX, y: 0, areaWidth: fieldWidth },
    hand,
    // 落点判定就是战场外框本身：黑客松版没有「离手牌留几张卡」那条额外的让位。
    dropZone: { ...boardFrame },
    deck: deckPose(panels.mine),
    endPlay,
    revealScale: tokens.size.card.revealScale,
    banner: { x: fanCenterX, y: height / 2 },
    bubble: { x: fanCenterX, y: height - HAND_ZONE - BUBBLE_GAP },
  }
}

/**
 * 侧栏里上下两块玩家面板。
 *
 * 上面是对方、下面是我，和黑客松版一致。两块等分侧栏内容区的高度，中间让出分隔线那一行，
 * 于是设计尺寸下每块是 266×373.5——英雄牌按 2:3 填满就是 249×373.5，和那一版量到的数对上。
 */
function panelRects(sideBar: Rect): { theirs: Rect; mine: Rect } {
  const width = sideBar.width - SIDE_PAD.x * 2
  const usable = sideBar.height - SIDE_PAD.y * 2 - PANEL_GAP * 2 - PANEL_DIVIDER
  const height = usable / 2
  const x = sideBar.x + SIDE_PAD.x
  const top = sideBar.y + SIDE_PAD.y
  return {
    theirs: { x, y: top, width, height },
    mine: { x, y: top + height + PANEL_GAP * 2 + PANEL_DIVIDER, width, height },
  }
}

/**
 * 发牌从我方英雄牌右下角那摞牌起飞。
 *
 * 卡的原点在底边中点，按 `scale` 缩之后卡心落在原点上方半张卡处，所以想让卡心正对牌堆中心，
 * 起飞点的 y 就要取牌堆的**下沿**。`PlayerPanel` 画那一摞时调的是同一个 `deckPileRectOf`，
 * 两处算出来必然是同一个矩形。
 */
function deckPose(minePanel: Rect): { x: number; y: number; scale: number } {
  const pile = deckPileRectOf(heroCardRectOf(minePanel, 0), 'bottom')
  const scale = pile.height / CARD_HEIGHT
  return { x: pile.x + pile.width / 2, y: pile.y + pile.height, scale }
}
