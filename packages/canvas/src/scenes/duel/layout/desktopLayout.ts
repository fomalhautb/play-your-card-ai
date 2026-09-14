/**
 * 桌面档版式：顶栏一条、左边一列侧栏、右边一整块战场，手牌沉在视口底边。
 *
 * 这一档是旧版 1672×941 那套版式的直接后代，尺寸全部读 `size.battle.*` 令牌。
 * 和手机档的关系是**并列**，不是缩放：那边侧栏折叠成一行、战场整块缩小、手牌区更高，
 * 三处都在各自的文件里独立算（需求第 3 条）。
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

/** 战场离左右两边留多宽。旧样式 `.battle__battlefield` 的内边距。 */
const FIELD_PAD_X = 16

/**
 * 出牌区下沿离手牌锚点留多少张卡高。
 *
 * 贴着手牌的话，指针刚把牌抬起来一点就越线了，玩家会觉得「我还没往上拖呢牌就出去了」。
 * 鼠标档指针就压在卡面上，留 0.75 张卡高够用；触屏档要留更多，见 mobileLayout。
 */
const DROP_GAP_CARDS = 0.75

/** 「结束出牌」按钮离右下角多远。 */
const END_PLAY_INSET = { x: 28, y: 20 }

/** 牌库那摞牌的缩放和它离右下角的距离。 */
const DECK = { scale: 0.34, inset: 0.03 }

/** 右下角「结束出牌」那颗钮的中心，按它自己那一档的尺寸算。 */
function endPlayCenter(width: number, height: number, handZone: number): { x: number; y: number } {
  return {
    x: width - tokens.size.plaque.endTurnWidth / 2 - END_PLAY_INSET.x,
    y: height - handZone - tokens.size.plaque.endTurnHeight / 2 - END_PLAY_INSET.y,
  }
}

export function desktopLayout(width: number, height: number): DuelLayout {
  const topBarHeight = tokens.size.battle.topbarHeight
  // 侧栏宽度按令牌取，但窄屏（比如 1024 宽的横屏平板）上不许吃掉四分之一以上的宽，
  // 否则战场那一排格子会先被挤到压边。
  const sideWidth = Math.min(tokens.size.battle.sidebarWidth, width * 0.24)
  const sideBar = { x: 0, y: topBarHeight, width: sideWidth, height: height - topBarHeight }

  const fieldX = sideWidth
  const fieldWidth = width - sideWidth
  const foeZone = tokens.size.battle.foeHandHeight
  const handZone = tokens.size.battle.handZoneHeight

  const boardRect = {
    x: fieldX + FIELD_PAD_X,
    y: topBarHeight + foeZone,
    width: fieldWidth - FIELD_PAD_X * 2,
    height: Math.max(0, height - topBarHeight - foeZone - handZone),
  }
  const boardScale = fitBoardScale(boardRect.width, boardRect.height)

  const handScale = clamp(fieldWidth / DESIGN_FAN_WIDTH, MIN_HAND_SCALE, 1)
  // 锚点压在视口底边：整排抬进视口多少已经由 PLAYER_FAN.sink 管了，这里再抬一次就是抬两遍。
  const hand = {
    x: fieldX + fieldWidth / 2,
    y: height,
    scale: handScale,
    areaWidth: (fieldWidth * 0.94) / handScale,
  }

  const dropTop = topBarHeight + foeZone * 0.5
  const dropBottom = hand.y - CARD_HEIGHT * handScale * DROP_GAP_CARDS
  const dropZone = {
    x: fieldX + FIELD_PAD_X,
    y: dropTop,
    width: fieldWidth - FIELD_PAD_X * 2,
    height: Math.max(0, dropBottom - dropTop),
  }

  const deckScale = DECK.scale * handScale
  const deck = {
    x: width - CARD_WIDTH * deckScale - width * DECK.inset,
    y: height - handZone * 0.5,
    scale: deckScale,
  }

  return {
    tier: 'desktop',
    width,
    height,
    topBarHeight,
    sideBar,
    panelRow: null,
    board: { ...boardRect, scale: boardScale },
    foeHand: {
      x: fieldX + fieldWidth / 2,
      y: topBarHeight,
      areaWidth: (fieldWidth * 0.9) / FOE_FAN_SCALE,
    },
    hand,
    dropZone,
    deck,
    endPlay: endPlayCenter(width, height, handZone),
    revealScale: tokens.size.card.revealScale,
    bubble: { x: fieldX + fieldWidth / 2, y: height - handZone - 28 },
  }
}
