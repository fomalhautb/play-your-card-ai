/**
 * 对局原型的版式：视口多大、扇形铺多宽、出牌区在哪、战场落点在哪、牌库在哪。
 *
 * 需求第 3 条要求手机小屏和电脑大屏是并列的一等公民，不做整体缩放。这里的做法是：
 * 所有位置都按**视口的比例**算，只有手牌那一排因为卡面有固定尺寸（150×225）
 * 才单独带一个自己的缩放——那是"手牌这个组件在小屏上换一档尺寸"，
 * 不是把整个 1672×941 的桌面版式按比例缩到手机上（黑客松那条路已经废弃）。
 * 战场落点、出牌区、牌库位置在两档下各按各的比例算，互不牵连。
 */

import { tokens } from '@ai-duel/design'
import type { DropZoneRect } from '../interaction/dragRules'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'

/** 窄于这个宽度就按触屏档排版。和旧样式里那条移动端媒体查询同一个断点。 */
const TOUCH_BREAKPOINT = 768

/** 手牌按设计尺寸铺开时想要的可用宽度。窄于它就把整排手牌缩一档。 */
const DESIGN_FAN_WIDTH = 1000

/** 手牌缩放的下限。再小卡面上的名字就看不清了。 */
const MIN_HAND_SCALE = 0.55

export interface DuelLayout {
  width: number
  height: number
  /** 是不是触屏档。两档是并列的版式，不是一个缩放系数。 */
  touch: boolean
  /** 手牌那一排整体的缩放。只作用于手牌容器，别的东西不跟着缩。 */
  handScale: number
  /** 手牌锚点（视口坐标）：整排扇形的原点，在视口底边中点往上抬一点。 */
  handOrigin: { x: number; y: number }
  /** 扇形能铺多宽，单位是**手牌容器自己的坐标**（已经把 handScale 折算进去了）。 */
  fanAreaWidth: number
  /** 出牌区：指针在这块矩形里松手才算打出。视口坐标。 */
  dropZone: DropZoneRect
  /** 战场上每个落点的中心（视口坐标），从左到右。 */
  boardSlots: { x: number; y: number }[]
  /** 落到战场之后卡牌缩到多大。 */
  boardScale: number
  /** 牌库那摞牌的位置和大小（视口坐标），发牌从这儿起飞。 */
  deck: { x: number; y: number; scale: number }
}

/** 战场上摆几个落点。原型里够用就行，正式版由局面决定。 */
const BOARD_SLOTS = 5

export function computeLayout(width: number, height: number): DuelLayout {
  const touch = width < TOUCH_BREAKPOINT
  const handScale = Math.min(1, Math.max(MIN_HAND_SCALE, width / DESIGN_FAN_WIDTH))

  /*
   * 手牌锚点就压在视口底边中点上，不额外往上抬。
   *
   * "整排抬进视口多少"这件事已经由 PLAYER_FAN.sink 管了（−32，见 fanMath 里那段说明），
   * 在这儿再抬一次就是抬了两遍：扇形会整个浮在屏幕中间，而两端那两个角本来就该沉出视口，
   * 那是"一叠握在手里的牌"的样子。
   */
  const handOrigin = { x: width / 2, y: height }

  // 可用宽度先在视口坐标里量，再除以手牌自己的缩放换算回容器坐标——
  // fanMath 那套公式吃的是卡面基准尺寸下的像素。
  const fanAreaWidth = (width * 0.94) / handScale

  /*
   * 出牌区的下沿要和手牌拉开距离：贴着手牌的话，指针刚把牌抬起来一点就越线了，
   * 玩家会觉得"我还没往上拖呢牌就出去了"。
   *
   * 两档留的距离不一样，这是两档版式真正分岔的地方之一：触屏拖拽时牌会被抬到手指上方
   * 半张卡高（免得手指盖住卡面，见 handPointer 里那段 lift），所以判定用的指针位置
   * 比玩家看到的牌低一截；出牌区的下沿要跟着往上挪同样多，否则"牌明明还在手牌区里"
   * 就已经算越线了。
   */
  const handZoneRatio = touch ? 1.3 : 0.75
  const handZoneTop = handOrigin.y - CARD_HEIGHT * handScale * handZoneRatio
  const dropZone: DropZoneRect = {
    x: width * 0.04,
    y: height * 0.1,
    width: width * 0.92,
    height: Math.max(0, handZoneTop - height * 0.1),
  }

  const boardScale = tokens.size.card.tileScale * handScale
  const slotGap = CARD_WIDTH * boardScale * 1.12
  const boardY = dropZone.y + dropZone.height * 0.62
  const boardSlots = Array.from({ length: BOARD_SLOTS }, (_, i) => ({
    x: width / 2 + (i - (BOARD_SLOTS - 1) / 2) * slotGap,
    y: boardY,
  }))

  /*
   * 牌库摆在右下角、手牌之外：发牌是"从那摞牌里抽一张甩到手上"，
   * 起点必须看得见，藏在手牌底下的话玩家只会看到牌凭空出现。
   */
  const deckScale = 0.34 * handScale
  const deck = {
    x: width - CARD_WIDTH * deckScale - width * 0.03,
    y: handOrigin.y - CARD_HEIGHT * deckScale * 1.4,
    scale: deckScale,
  }

  return {
    width,
    height,
    touch,
    handScale,
    handOrigin,
    fanAreaWidth,
    dropZone,
    boardSlots,
    boardScale,
    deck,
  }
}
