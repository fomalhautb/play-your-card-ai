/**
 * 玩家面板里那两块东西的几何：英雄牌占多大、牌库那一摞压在哪个角上。
 *
 * 单独成文件是因为**两头都要算它**：`components/PlayerPanel` 要拿它摆卡和画牌堆，
 * 对局版式（`scenes/duel/layout/desktopLayout`）要拿它推发牌的起飞姿态。
 * 抄成两份的话，改了面板的留白而忘了改版式，发出来的牌就会从一个空位上飞出来。
 *
 * 和 `fanMath` 一样：只算数，不碰任何 Pixi 对象。
 */

import { CARD_HEIGHT, CARD_WIDTH } from './fanMath'

/** 一块矩形。坐标以调用方给的原点为准，这一份不关心是舞台坐标还是面板内坐标。 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 一块玩家面板里那张英雄牌占的矩形：2:3 填满面板，四周各留 `inset`。
 *
 * 传面板在舞台上的矩形就得到舞台坐标，传 `{ x: 0, y: 0, ... }` 就得到面板内坐标。
 */
export function heroCardRectOf(panel: Rect, inset: number): Rect {
  const scale = Math.max(
    0,
    Math.min((panel.width - inset * 2) / CARD_WIDTH, (panel.height - inset * 2) / CARD_HEIGHT),
  )
  const width = CARD_WIDTH * scale
  const height = CARD_HEIGHT * scale
  return {
    x: panel.x + (panel.width - width) / 2,
    y: panel.y + (panel.height - height) / 2,
    width,
    height,
  }
}

/** 牌堆那一摞相对英雄牌多宽、离卡角多远。抄黑客松版 `.battle__deck` 的那四个比例。 */
const DECK_PILE = { widthRatio: 0.28, minWidth: 24, aspect: 1.5, inX: 0.045, inY: 0.035 } as const

/**
 * 牌堆那一摞压在英雄牌的哪个角上。
 *
 * 我方（下面那块面板）在卡的右下角，对方（上面那块）在右上角，上下镜像——两块面板本来就是
 * 照战场那条中线对称摆的，卡堆跟着镜像，两边的「自己的牌从自己那头飞出来」才对得上。
 */
export function deckPileRectOf(hero: Rect, side: 'top' | 'bottom'): Rect {
  const width = Math.max(DECK_PILE.minWidth, hero.width * DECK_PILE.widthRatio)
  const height = width * DECK_PILE.aspect
  const right = hero.x + hero.width - hero.width * DECK_PILE.inX
  const inY = hero.height * DECK_PILE.inY
  return {
    x: right - width,
    y: side === 'bottom' ? hero.y + hero.height - inY - height : hero.y + inY,
    width,
    height,
  }
}
