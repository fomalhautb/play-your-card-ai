/**
 * 两档对局版式共用的形状、常量和坐标换算。
 *
 * 需求第 3 条：手机小屏和电脑大屏是**并列**的两档版式，不是把桌面版整体缩放。
 * 所以这里只定「两档都要回答哪些问题」，各自的答案分别写在 desktopLayout.ts 和
 * mobileLayout.ts 里——同一个字段两档可以算得完全不一样（侧栏在桌面档是竖着一列、
 * 在手机档折叠成顶上一行，战场在手机档还要整块缩小），谁也不是谁的缩放。
 *
 * 版式只输出**数**，不碰任何 Pixi 对象：两档的几何因此能在 vitest 里直接断言
 *（手牌区不和战场重叠、侧栏在手机档折叠……），不用起浏览器。
 */

import { tokens } from '@ai-duel/design'
import type { DropZoneRect } from '../../../interaction/dragRules'

/** 两档版式。名字按屏幕形态取，不按设备品类——平板横屏走桌面档。 */
export type LayoutTier = 'desktop' | 'mobile'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DuelLayout {
  tier: LayoutTier
  width: number
  height: number
  /** 顶栏压在视口顶边，整条通宽，只有高度两档不同。 */
  topBarHeight: number
  /**
   * 桌面档的左侧栏（两块玩家面板和「下一题」纸匾竖着排）。
   * 手机档没有它，改成下面的 `panelRow`——两档在这里是真的分岔。
   */
  sideBar: Rect | null
  /**
   * 手机档把侧栏折叠成的一行：两块玩家面板左右并排贴在顶栏下面。桌面档为 null。
   * 折叠掉的是「下一题」纸匾和 Token 细条那两样竖着才摆得下的东西。
   */
  panelRow: (Rect & { gap: number }) | null
  /**
   * 战场那一块，外加它自己的缩放。
   *
   * 缩放不是「把桌面版缩小」，而是**格子换一档尺寸**：战场格子是 110×165 的死数
   *（`size.card.tile*`），手机屏上一排五格摆不下，只能把整块战场按装得下的比例缩。
   * BoardGrid 仍按 `width / scale × height / scale` 排版，缩放写在容器的 scale 上
   *（只动 transform，符合纪律 3.10）。
   */
  board: Rect & { scale: number }
  /** 对手手牌：锚点（视口坐标，牌从这儿往下垂）和可铺开的宽度（扇形自己的坐标）。 */
  foeHand: { x: number; y: number; areaWidth: number }
  /** 我方手牌：扇形锚点、整排缩放，以及折算过缩放的可用宽度。 */
  hand: { x: number; y: number; scale: number; areaWidth: number }
  /** 出牌区：指针在这块矩形里松手才算打出。视口坐标。 */
  dropZone: DropZoneRect
  /** 牌库那摞牌的位置和大小（视口坐标），发牌从这儿起飞。 */
  deck: { x: number; y: number; scale: number }
  /** 「结束出牌」按钮的中心（视口坐标）。 */
  endPlay: { x: number; y: number }
  /** 放大查看时卡在屏幕中央放到多大。触屏档更大，见 `size.card.revealScaleTouch`。 */
  revealScale: number
  /** 提示气泡（催一催、指令被拒）的中心。 */
  bubble: { x: number; y: number }
}

/** 手牌按设计尺寸铺开时想要的可用宽度。窄于它就把整排手牌缩一档。 */
export const DESIGN_FAN_WIDTH = 1000

/** 手牌缩放的下限。再小卡面上的名字就看不清了。 */
export const MIN_HAND_SCALE = 0.55

/** 战场缩放的下限。再小就看不出小卡上印的是谁了。 */
const MIN_BOARD_SCALE = 0.45

/**
 * 一排五格、上下两排时战场想要的原始尺寸（不缩放的话）。
 * 宽按 BoardGrid 里 `SLOT_STEP`（1.12 个格宽）算，高按两排格子再加中线那一行。
 */
const DESIGN_BOARD_WIDTH = tokens.size.card.tileWidth * 1.12 * 5
const DESIGN_BOARD_HEIGHT = tokens.size.card.tileHeight * 2 + 40

/**
 * 对手那排扇形整体缩到多小。
 *
 * 这个数是 `FoeHand` 组件私有的（它自己的 `CARD_SCALE`），版式这边要它只为一件事：
 * `setAreaWidth` 吃的是**扇形自己坐标系**里的像素，而版式量的是屏幕上的宽，
 * 两者差的正是这个倍数。组件不导出它，所以这里抄一份并注明来源——
 * 改了那边这里要跟着改（目录页的 FoeHand 条目也抄了同一个数）。
 */
export const FOE_FAN_SCALE = 0.64

/**
 * 视口坐标 → 手牌容器坐标。
 * 两层之间只有平移（锚点）和等比缩放，所以换算就是减一下再除一下。
 */
export function toFanLocal(layout: DuelLayout, x: number, y: number): { x: number; y: number } {
  const { hand } = layout
  return { x: (x - hand.x) / hand.scale, y: (y - hand.y) / hand.scale }
}

/** 手牌容器坐标 → 视口坐标，连缩放一起换算。 */
export function fanToWorld(
  layout: DuelLayout,
  x: number,
  y: number,
  scale: number,
): { x: number; y: number; scale: number } {
  const { hand } = layout
  return { x: hand.x + x * hand.scale, y: hand.y + y * hand.scale, scale: scale * hand.scale }
}

/** 战场自己的坐标 → 视口坐标。飞行落点和命中特效的范围都要过这一道。 */
export function boardToWorld(
  layout: DuelLayout,
  point: { x: number; y: number },
): { x: number; y: number } {
  const { board } = layout
  return { x: board.x + point.x * board.scale, y: board.y + point.y * board.scale }
}

/** 夹在上下限之间。两档版式都要用，写一遍。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 战场能缩到多大：宽高两边各按「装得下」算，取小的那个，再封顶到 1。
 *
 * 封顶到 1 是因为格子的 110×165 是设计尺寸，放大只会让小卡糊掉——
 * 大屏上多出来的地方留白，不是把卡撑大。
 */
export function fitBoardScale(width: number, height: number): number {
  const fit = Math.min(width / DESIGN_BOARD_WIDTH, height / DESIGN_BOARD_HEIGHT)
  return clamp(fit, MIN_BOARD_SCALE, 1)
}
