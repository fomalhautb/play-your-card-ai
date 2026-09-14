/**
 * 手机档版式：竖着排一列——顶栏、折叠成一行的两块玩家面板、对手手牌、战场、我方手牌。
 *
 * 这一档**不缩放**：算出来的就是视口坐标（桌面档那边是 1672×941 死版式再整块缩放，
 * 见 desktopLayout 的文件头）。所以 `stage` 是恒等变换、`viewport` 就是 `width × height`。
 *
 * 和桌面档并列，三处真的分岔（需求第 3 条，不是缩放）：
 * 1. **侧栏折叠成顶栏下面一行**：竖着的侧栏在 390 宽的屏幕上要吃掉一半宽，
 *    剩下的地方摆不下战场。折叠之后「下一题」纸匾和 Token 细条一起去掉——
 *    它们是竖排才有位置的东西，横过来会把两块面板挤扁。
 * 2. **战场整块缩小**：格子是 110×165 的死数，一排五格要 616 宽，390 的屏上装不下。
 *    缩的是格子尺寸这一档，不是把桌面版按比例缩到手机上。
 * 3. **手牌区更高**：手指要有地方按住牌往上拖，而拖起来的牌还要抬到手指上方半张卡高
 *   （见 handPointer 的 lift），底下留 250 不够。
 */

import { tokens } from '@ai-duel/design'
import { CARD_HEIGHT, CARD_WIDTH } from '../../../layout/fanMath'
import {
  clamp,
  DESIGN_FAN_WIDTH,
  type DuelLayout,
  FOE_FAN_SCALE,
  fitBoardScale,
  MIN_HAND_SCALE,
} from './types'

/** 各块离屏幕左右两边留多宽。 */
const PAD_X = 8

/** 折叠出来那一行的高度，以及两块面板之间的空隙。够摆下一张缩小的英雄牌加铭牌。 */
const PANEL_ROW = { height: 96, gap: 8 }

/** 对手手牌那一条占多高。比桌面档的 84 矮一截——手机上它只需要说明「对面还有几张」。 */
const FOE_ZONE = 68

/** 手牌区占屏高的比例，以及它的上下限。 */
const HAND_ZONE = { ratio: 0.36, min: 220, max: 340 }

/**
 * 出牌区下沿离手牌锚点留多少张卡高。
 *
 * 比桌面档多留一截：触屏拖拽时牌会被抬到手指上方半张卡高（见 handPointer 的 lift），
 * 判定用的指针位置比玩家看到的牌低一截，出牌区下沿要跟着往上挪同样多，
 * 否则「牌明明还在手牌区里」就已经算越线了。
 */
const DROP_GAP_CARDS = 1.3

/** 「结束出牌」按钮离右下角多远。 */
const END_PLAY_INSET = { x: 12, y: 10 }

/** 牌库那摞牌的缩放和它离右边多远。 */
const DECK = { scale: 0.3, inset: 0.04 }

/** 右下角那一颗钮占的那块，贴着手牌区上沿。 */
function endPlayRect(
  width: number,
  height: number,
  handZone: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: width - tokens.size.plaque.endTurnWidth - END_PLAY_INSET.x,
    y: height - handZone - tokens.size.plaque.endTurnHeight - END_PLAY_INSET.y,
    width: tokens.size.plaque.endTurnWidth,
    height: tokens.size.plaque.endTurnHeight,
  }
}

export function mobileLayout(width: number, height: number): DuelLayout {
  const topBarHeight = tokens.size.battle.topbarHeightTouch
  const panelRow = {
    x: PAD_X,
    y: topBarHeight,
    width: width - PAD_X * 2,
    height: PANEL_ROW.height,
    gap: PANEL_ROW.gap,
  }

  const handZone = clamp(height * HAND_ZONE.ratio, HAND_ZONE.min, HAND_ZONE.max)
  const boardTop = topBarHeight + panelRow.height + FOE_ZONE
  const boardRect = {
    x: PAD_X,
    y: boardTop,
    width: width - PAD_X * 2,
    height: Math.max(0, height - boardTop - handZone),
  }
  const boardScale = fitBoardScale(boardRect.width, boardRect.height)

  const handScale = clamp(width / DESIGN_FAN_WIDTH, MIN_HAND_SCALE, 1)
  const hand = {
    x: width / 2,
    y: height,
    scale: handScale,
    areaWidth: (width * 0.94) / handScale,
  }

  const dropTop = topBarHeight + panelRow.height
  const dropBottom = hand.y - CARD_HEIGHT * handScale * DROP_GAP_CARDS
  const dropZone = {
    x: PAD_X,
    y: dropTop,
    width: width - PAD_X * 2,
    height: Math.max(0, dropBottom - dropTop),
  }

  const deckScale = DECK.scale * handScale
  const deck = {
    x: width - CARD_WIDTH * deckScale - width * DECK.inset,
    y: height - handZone * 0.35,
    scale: deckScale,
  }

  // 折叠那一行里两块面板左右平分，中间留一个空隙。上面的两档版式共用 `panels` 这一个字段。
  const panelWidth = Math.max(0, (panelRow.width - panelRow.gap) / 2)
  const panels = {
    theirs: { x: panelRow.x, y: panelRow.y, width: panelWidth, height: panelRow.height },
    mine: {
      x: panelRow.x + panelWidth + panelRow.gap,
      y: panelRow.y,
      width: panelWidth,
      height: panelRow.height,
    },
  }

  return {
    tier: 'mobile',
    width,
    height,
    // 这一档不缩放：舞台坐标就是视口坐标，两项写成恒等变换。
    viewport: { width, height },
    stage: { scale: 1, x: 0, y: 0 },
    topBarHeight,
    sideBar: null,
    panels,
    // 这一档没有「战场外框」那一圈内边距，外框和格子区是同一块。
    boardFrame: { ...boardRect },
    board: { ...boardRect, scale: boardScale },
    // 落点提示、Token 细条贴边、两块吊匾都是竖排才摆得下的东西，这一档一律没有。
    dropCue: null,
    tokenRail: null,
    nextPlaque: null,
    turnPlaque: null,
    foeHand: {
      x: width / 2,
      y: topBarHeight + panelRow.height,
      areaWidth: (width * 0.9) / FOE_FAN_SCALE,
    },
    hand,
    dropZone,
    deck,
    endPlay: endPlayRect(width, height, handZone),
    // 触屏档放大得更多：1.7 倍在手机上只有约 126 个屏幕像素宽，和「点开看清楚」差得远。
    revealScale: tokens.size.card.revealScaleTouch,
    banner: { x: width / 2, y: height * 0.24 },
    bubble: { x: width / 2, y: height - handZone - 20 },
  }
}
