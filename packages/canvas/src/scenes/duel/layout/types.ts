/**
 * 两档对局版式共用的形状、常量和坐标换算。
 *
 * 需求第 3 条：手机小屏和电脑大屏是**并列**的两档版式。这里只定「两档都要回答哪些问题」，
 * 各自的答案分别写在 desktopLayout.ts 和 mobileLayout.ts 里——同一个字段两档可以算得完全不一样
 *（侧栏在桌面档是竖着一列、在手机档折叠成顶上一行）。
 *
 * ## 两档的坐标系不是同一个
 *
 * 桌面档回到了黑客松版那套「1672×941 死版式 + 整块等比缩放居中」：`width` / `height`
 * 恒为 1672×941，全部矩形都是**设计坐标**；真实视口和换算写在 `viewport` / `stage` 两项里，
 * 由场景写到舞台根节点的 scale 和 position 上（见 DuelScene 的 applyStageTransform）。
 * 手机档不缩放：`stage.scale` 为 1、偏移为 0，于是设计坐标就是视口坐标，两档共用同一套下游代码。
 *
 * 换句话说：**除了 `viewport`，这里所有的数都是舞台坐标**。指针事件进来的是视口坐标，
 * 要先过一次舞台的 `toLocal`（HandPointer 自己做，见它的文件头）。
 *
 * 版式只输出**数**，不碰任何 Pixi 对象：两档的几何因此能在 vitest 里直接断言，不用起浏览器。
 */

import { tokens } from '@ai-duel/design'
import type { DropZoneRect } from '../../../interaction/dragRules'
import type { Rect } from '../../../layout/panelGeometry'

/** 两档版式。名字按屏幕形态取，不按设备品类——平板横屏走桌面档。 */
export type LayoutTier = 'desktop' | 'mobile'

export type { Rect }

export interface DuelLayout {
  tier: LayoutTier
  /** 舞台自己那套坐标的宽高。桌面档恒为 1672×941，手机档就是视口。 */
  width: number
  height: number
  /** 真实视口。场景靠它判断「尺寸变了没有」，别处一律别读它。 */
  viewport: { width: number; height: number }
  /** 舞台放进视口的等比缩放和左上角偏移。手机档是 scale 1、偏移 0 的恒等变换。 */
  stage: { scale: number; x: number; y: number }
  /** 顶栏压在舞台顶边，整条通宽，只有高度两档不同。 */
  topBarHeight: number
  /** 桌面档的左侧栏外框（两块玩家面板竖着排在里面）。手机档没有它。 */
  sideBar: Rect | null
  /**
   * 两块玩家面板。桌面档是侧栏里上下两块，手机档是顶栏下面并排的两块——
   * 两档的位置完全不同，但「有这么两块」是共同的，所以字段只有一个。
   */
  panels: { theirs: Rect; mine: Rect }
  /**
   * 战场外框：画描边、判落点都用它。
   *
   * 和下面的 `board` 差一圈内边距（黑客松版 `.battle__board` 的 52/24/18）。
   * 顶上那 52 是给拖拽时的落点提示让位的，见 `dropCue`。
   */
  boardFrame: Rect
  /**
   * 格子占的那块（外框减掉内边距），外加它自己的缩放。
   *
   * 缩放不是「把桌面版缩小」，而是**格子换一档尺寸**：战场格子是 110×165 的死数，
   * 手机屏上一排五格摆不下，只能把整块战场按装得下的比例缩。
   * BoardGrid 仍按 `width / scale × height / scale` 排版，缩放写在容器的 scale 上。
   */
  board: Rect & { scale: number }
  /** 拖着牌时战场顶部那条落点提示。手机档没有（那 52px 的让位是桌面档才有的）。 */
  dropCue: Rect | null
  /**
   * 手牌区那一整条「取消区」：拖着牌时亮出来，松在这儿就是把牌收回手上。
   *
   * 它和落点区首尾相接，只是**视觉热区**——真正的判定仍然是「指针在不在 `dropZone` 里」
   *（见 interaction/dragRules.ts），松在战场外一律取消。抄黑客松的 `.battle__return-zone`。
   */
  returnZone: Rect
  /** Token 细条贴舞台右缘。手机档为 null——那一档细条仍挂在我方面板里面。 */
  tokenRail: Rect | null
  /** 「下一题」匾，吊在战场右上角。手机档折叠掉了。 */
  nextPlaque: Rect | null
  /** 「对方回合」吊匾，吊在顶栏下沿、对着战场居中。手机档没有。 */
  turnPlaque: Rect | null
  /** 对手手牌：锚点（舞台坐标，牌从这儿往下垂）和可铺开的宽度（扇形自己的坐标）。 */
  foeHand: { x: number; y: number; areaWidth: number }
  /** 我方手牌：扇形锚点、整排缩放，以及折算过缩放的可用宽度。 */
  hand: { x: number; y: number; scale: number; areaWidth: number }
  /** 出牌区：指针在这块矩形里松手才算打出。舞台坐标。 */
  dropZone: DropZoneRect
  /**
   * 发牌起飞的那一点：卡的**底边中点**落在这儿，外加当时的缩放。
   * 桌面档是英雄牌角上那摞牌的底边中点，手机档是右下角空中的一个点（那一档不画牌堆）。
   */
  deck: { x: number; y: number; scale: number }
  /** 「结束出牌」按钮占的那块。 */
  endPlay: Rect
  /** 放大查看时卡在屏幕中央放到多大。触屏档更大，见 `size.card.revealScaleTouch`。 */
  revealScale: number
  /**
   * 侧栏那张英雄牌放大到多大，比普通卡高一档。
   *
   * 它在面板里本来就有两百多宽，按普通卡那档飞到中央反而比原位还小
   *（黑客松同理，`--reveal-scale` 在 `.reveal-clip--hero` 上被覆盖过）。
   */
  revealScaleHero: number
  /** 中央横幅那行大字的中心。 */
  banner: { x: number; y: number }
  /** 提示气泡（指令被拒的红字）的中心。 */
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
 * 宽按一排五格再留一成余量算，高按两排格子再加中线那一行。
 */
const DESIGN_BOARD_WIDTH = tokens.size.card.tileWidth * 1.12 * 5
const DESIGN_BOARD_HEIGHT = tokens.size.card.tileHeight * 2 + 40

/**
 * 对手那排扇形整体缩到多小。
 *
 * 这个数是 `FoeHand` 组件私有的（它自己的 `CARD_SCALE`），手机档版式要它只为一件事：
 * `setAreaWidth` 吃的是**扇形自己坐标系**里的像素，而那一档量的是屏幕上的宽，
 * 两者差的正是这个倍数。组件不导出它，所以这里抄一份并注明来源——
 * 改了那边这里要跟着改（目录页的 FoeHand 条目也抄了同一个数）。
 * 桌面档不用它：那一档照黑客松口径直接把战场宽当扇形坐标里的可铺宽（见 desktopLayout）。
 */
export const FOE_FAN_SCALE = 0.64

/**
 * 舞台坐标 → 手牌容器坐标。
 * 两层之间只有平移（锚点）和等比缩放，所以换算就是减一下再除一下。
 */
export function toFanLocal(layout: DuelLayout, x: number, y: number): { x: number; y: number } {
  const { hand } = layout
  return { x: (x - hand.x) / hand.scale, y: (y - hand.y) / hand.scale }
}

/** 手牌容器坐标 → 舞台坐标，连缩放一起换算。 */
export function fanToWorld(
  layout: DuelLayout,
  x: number,
  y: number,
  scale: number,
): { x: number; y: number; scale: number } {
  const { hand } = layout
  return { x: hand.x + x * hand.scale, y: hand.y + y * hand.scale, scale: scale * hand.scale }
}

/** 战场自己的坐标 → 舞台坐标。飞行落点和命中特效的范围都要过这一道。 */
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
