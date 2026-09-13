/**
 * 选英雄页两档版式。**只输出数、不碰 Pixi 对象**，所以两档几何在 vitest 里直接断言得了。
 *
 * ## 桌面档是 1672×941 的死版式
 *
 * 正式版简化第 4 步之五把这一档改回黑客松那一版：一块 1672×941 的舞台整块等比缩放居中
 *（同对局页和组牌页，`stage` / `viewport` 两项就是给场景写到根节点上的），舞台里每一个数
 * 都照 `screens/hero.css` 来。那一版的尺寸写成 `cqi`（1cqi = 舞台宽的百分之一 = 16.72），
 * 下面一律写成 `n * CQI`，改任何一个数之前先回去核对那份样式表。
 *
 * 为什么回到死版式：那一页的每一处都是照 1920×1080 的设计稿量出来再除以 19.2 记成 cqi 的
 *（卡宽 240px、同排间隙 64px、两排间距 46px 是一组互相咬住的数），按真实视口实算的话
 * 这些关系要各自重推一遍，而窗口比例一变又对不上。整块缩放只写一个 transform。
 *
 * ## 手机档和它**并列**
 *
 * 两档的分岔在**分几排**：桌面 4 + 3，手机 3 + 2 + 2。竖屏 390 宽里排四张的话一张只有
 * 87 宽、卡面上的字全糊了；而 3 + 3 + 1 的最后一排孤零零一张，看着像掉了一张。
 * 手机档仍然按视口比例实算（`stage.scale` 恒为 1，舞台坐标就是视口坐标），这一步
 * **一个数都没动**（需求第 3 条）。详情浮层同理：桌面档卡在左、说明在右，手机档卡居中、
 * 说明摞在下面。
 */

import { CARD_WIDTH } from '../../layout/fanMath'
import { pickTier } from '../duel/layout/pickLayout'
import type { LayoutTier } from '../duel/layout/types'

/** 人物卡的长宽比（素材 768×1152）。 */
const CARD_RATIO = 1152 / 768

/** 设计稿尺寸。和对局页、组牌页同一块舞台（黑客松 `ui/battleStage.ts`）。 */
const DESIGN_WIDTH = 1672
const DESIGN_HEIGHT = 941
/** 黑客松那一版的长度单位：舞台宽的百分之一。下面每一个尺寸都写成它的倍数。 */
const CQI = DESIGN_WIDTH / 100

/**
 * 左上角那颗返回占多大，两档同用一档（取组牌页返回钮那一档）。
 * 它和标题是同一行，标题那格的宽要给它让路，见 titleRoom。
 */
const BACK = { width: 88, height: 34 } as const
/** 返回和标题之间至少留这么宽。 */
const TITLE_CLEARANCE = 8

/**
 * 桌面档那一摞数，全部出自 `screens/hero.css`：
 *
 * - `titleTop` = `.hero__head` 的 `top: 3.35%`；`titleHeight` = `.hero__title` 的 `2.85cqi`
 *  （行高 1，所以字号就是行盒的高）；`titleWidth` 是那六个字在设计稿上的实测宽（321px ÷ 19.2）。
 *   标题两侧那两支花饰已经删了，不再占地方。
 * - `subtitleGap` = `.hero__subtitle` 的 `margin-top: 0.5cqi`，`subtitleHeight` = `1.2cqi`；
 *   那一行没写宽度，按同一档字号下十五个字给 18cqi。
 * - `back` = `.hero__back` 的 `top: 4.2%` / `left: 3.09cqi`；方块尺寸取组牌页返回钮那一档。
 * - `gridTop` = `.hero__grid` 的 `top: 19%`；`card` = `.hero__card` 的 `width: 12.5cqi`；
 *   `rowGap` = `.hero__grid` 的 `gap: 2.4cqi`；`colGap` = `.hero__row` 的 `gap: 3.33cqi`。
 */
const DESKTOP = {
  rows: [4, 3],
  titleTop: DESIGN_HEIGHT * 0.0335,
  titleWidth: 16.72 * CQI,
  titleHeight: 2.85 * CQI,
  subtitleGap: 0.5 * CQI,
  subtitleWidth: 18 * CQI,
  subtitleHeight: 1.2 * CQI,
  back: { x: 3.09 * CQI, y: DESIGN_HEIGHT * 0.042 },
  gridTop: DESIGN_HEIGHT * 0.19,
  card: 12.5 * CQI,
  rowGap: 2.4 * CQI,
  colGap: 3.33 * CQI,
} as const

/**
 * 桌面档详情浮层那一摞数，同样出自 `hero.css`：
 *
 * 大卡 `.hero__detail-card` 宽 `22cqi`，和说明栏之间 `.hero__detail-body` 的 `gap: 4.8cqi`，
 * 说明栏 `.hero__detail-info` 宽 `30cqi`；这一行和底下那排钮之间 `.hero__detail` 的
 * `gap: 3.1cqi`，钮本身 `20cqi × 6.07cqi`、两颗之间 `.hero__detail-actions` 的 `gap: 3.1cqi`。
 * 整块（一行 + 间距 + 一排钮）在舞台里居中，所以下面是先算总高再反推上沿。
 */
const DETAIL = {
  card: 22 * CQI,
  bodyGap: 4.8 * CQI,
  info: 30 * CQI,
  columnGap: 3.1 * CQI,
  button: { width: 20 * CQI, height: 6.07 * CQI, gap: 3.1 * CQI },
} as const

/** 手机档：每排几张、各处留白、字号，全部是占视口的比例。这一步一个数都没改。 */
const MOBILE = {
  rows: [3, 2, 2],
  gap: 0.02,
  sideMargin: 0.04,
  topMargin: 0.17,
  bottomMargin: 0.14,
  titleY: 0.07,
  titleSize: 0.062,
  subtitleY: 0.115,
  subtitleSize: 0.032,
  /** 窄屏摆不下左右两栏，卡居中、说明摞在下面。 */
  detailAnchorX: 0.5,
  detailInfoWidth: 0.86,
} as const

export interface HeroRect {
  x: number
  y: number
  width: number
  height: number
}

export interface HeroLayout {
  tier: LayoutTier
  /** 舞台尺寸。桌面档恒为 1672×941，手机档就是视口。 */
  width: number
  height: number
  /** 真实视口，以及舞台缩放居中之后落在它的哪儿（交给 scenes/duel/stageFrame.ts）。 */
  viewport: { width: number; height: number }
  stage: { scale: number; x: number; y: number }
  /** 七张卡各自的盒子，顺序和英雄表一致。 */
  cards: HeroRect[]
  /** 标题、副标题、左上角那颗返回各占的方块。 */
  title: HeroRect
  subtitle: HeroRect
  back: HeroRect
  detail: {
    /** 放大的卡停在舞台横向、纵向的哪一处（0~1），交给 RevealOverlay 的两个锚点。 */
    anchorX: number
    anchorY: number
    /** 卡放大到多少倍（相对卡面基准宽 150）。 */
    scale: number
    /** 说明栏的盒子。 */
    info: HeroRect
    /** 详情底部那两颗钮的尺寸和落点。 */
    buttons: { y: number; gap: number; width: number; height: number }
  }
}

export function pickHeroLayout(width: number, height: number, coarsePointer = false): HeroLayout {
  return pickTier(width, height, coarsePointer) === 'mobile'
    ? mobileLayout(width, height)
    : desktopLayout(width, height)
}

/** 一排一排摆下去，每排各自居中。两档共用。 */
function gridCards(
  rows: readonly number[],
  top: number,
  stageWidth: number,
  cardWidth: number,
  gaps: { row: number; col: number },
): HeroRect[] {
  const cardHeight = cardWidth * CARD_RATIO
  const cards: HeroRect[] = []
  let y = top
  for (const count of rows) {
    const rowWidth = count * cardWidth + (count - 1) * gaps.col
    let x = (stageWidth - rowWidth) / 2
    for (let i = 0; i < count; i += 1) {
      cards.push({ x, y, width: cardWidth, height: cardHeight })
      x += cardWidth + gaps.col
    }
    y += cardHeight + gaps.row
  }
  return cards
}

/**
 * 居中的标题那一格最宽能到多少：两边都要给左上角那颗返回让出位置。
 *
 * 只有手机档真的会撞上——那一档标题的中线（视口高 7%）和返回落在同一行，
 * 而桌面档的标题在 16.72cqi 里就印得下，离返回还差着大半个屏。字印不下时素方块会
 * 自己把字缩进格子里（见 components/Box.ts），所以这里只管别让两格叠在一起。
 */
function titleRoom(stageWidth: number, side: number): number {
  return Math.max(1, stageWidth - (side + BACK.width + TITLE_CLEARANCE) * 2)
}

/** 在一条横线上居中摆一个方块。 */
function centeredRow(stageWidth: number, top: number, width: number, height: number): HeroRect {
  return { x: (stageWidth - width) / 2, y: top, width, height }
}

function desktopLayout(viewWidth: number, viewHeight: number): HeroLayout {
  const width = DESIGN_WIDTH
  const height = DESIGN_HEIGHT
  const scale = Math.min(viewWidth / width, viewHeight / height)

  const title = centeredRow(width, DESKTOP.titleTop, DESKTOP.titleWidth, DESKTOP.titleHeight)
  const subtitle = centeredRow(
    width,
    title.y + title.height + DESKTOP.subtitleGap,
    DESKTOP.subtitleWidth,
    DESKTOP.subtitleHeight,
  )

  /*
   * 详情那一列：大卡那一行、一道间距、一排钮，整列在舞台里竖向居中。
   * 这一行的高就是大卡的高——说明栏和它共用同一个上沿（`.hero__detail-body` 是居中对齐的，
   * 而说明栏的高由内容撑，摆成上沿齐平读起来是一样的，还省掉一次「量完内容再居中」）。
   */
  const cardWidth = DETAIL.card
  const cardHeight = cardWidth * CARD_RATIO
  const columnHeight = cardHeight + DETAIL.columnGap + DETAIL.button.height
  const columnTop = (height - columnHeight) / 2
  // 大卡和说明栏并排，整行居中，所以大卡的左沿由「行宽」反推。
  const bodyWidth = cardWidth + DETAIL.bodyGap + DETAIL.info
  const bodyLeft = (width - bodyWidth) / 2

  return {
    tier: 'desktop',
    width,
    height,
    viewport: { width: viewWidth, height: viewHeight },
    stage: { scale, x: (viewWidth - width * scale) / 2, y: (viewHeight - height * scale) / 2 },
    cards: gridCards(DESKTOP.rows, DESKTOP.gridTop, width, DESKTOP.card, {
      row: DESKTOP.rowGap,
      col: DESKTOP.colGap,
    }),
    title,
    subtitle,
    back: { ...DESKTOP.back, ...BACK },
    detail: {
      anchorX: (bodyLeft + cardWidth / 2) / width,
      anchorY: (columnTop + cardHeight / 2) / height,
      scale: cardWidth / CARD_WIDTH,
      info: {
        x: bodyLeft + cardWidth + DETAIL.bodyGap,
        y: columnTop,
        width: DETAIL.info,
        height: cardHeight,
      },
      buttons: {
        y: columnTop + cardHeight + DETAIL.columnGap,
        gap: DETAIL.button.gap,
        width: DETAIL.button.width,
        height: DETAIL.button.height,
      },
    },
  }
}

function mobileLayout(width: number, height: number): HeroLayout {
  const spec = MOBILE
  const gap = width * spec.gap
  const side = width * spec.sideMargin
  const top = height * spec.topMargin
  const gridHeight = height * (1 - spec.topMargin - spec.bottomMargin)
  const widest = Math.max(...spec.rows)
  // 卡的宽由两条同时管：一排最多摆得下几张，以及所有排叠起来不许超过给的高度。
  const byWidth = (width - side * 2 - gap * (widest - 1)) / widest
  const byHeight = (gridHeight - gap * (spec.rows.length - 1)) / spec.rows.length / CARD_RATIO
  const cardWidth = Math.max(1, Math.min(byWidth, byHeight))
  const cardHeight = cardWidth * CARD_RATIO

  const rowsHeight = spec.rows.length * cardHeight + (spec.rows.length - 1) * gap
  const gridTop = top + (gridHeight - rowsHeight) / 2

  /*
   * 标题和副标题原来给的是「中线落在哪、字多大」。素方块不做字号（字自己缩进格子里），
   * 所以这里把同样的两个数读成「方块多高、中线落在哪」，位置一个没挪。
   */
  const titleHeight = height * spec.titleSize
  const subtitleHeight = height * spec.subtitleSize
  const infoWidth = width * spec.detailInfoWidth
  // 放大的卡按视口高定：让它占大约六成高，看得清又不顶到上下边。
  const detailCardHeight = height * 0.62
  const buttonWidth = Math.min(width * 0.3, 288)

  return {
    tier: 'mobile',
    width,
    height,
    viewport: { width, height },
    stage: { scale: 1, x: 0, y: 0 },
    cards: gridCards(spec.rows, gridTop, width, cardWidth, { row: gap, col: gap }),
    title: centeredRow(
      width,
      height * spec.titleY - titleHeight / 2,
      titleRoom(width, side),
      titleHeight,
    ),
    subtitle: centeredRow(
      width,
      height * spec.subtitleY - subtitleHeight / 2,
      width * 0.85,
      subtitleHeight,
    ),
    back: { x: side, y: height * 0.03, ...BACK },
    detail: {
      anchorX: spec.detailAnchorX,
      anchorY: 0.5,
      scale: detailCardHeight / (CARD_WIDTH * CARD_RATIO),
      info: {
        x: (width - infoWidth) / 2,
        // 说明摞在卡下面。
        y: height * 0.62,
        width: infoWidth,
        height: height * 0.24,
      },
      buttons: {
        y: height * 0.88,
        gap: width * 0.02,
        width: buttonWidth,
        height: (buttonWidth * 87) / 288,
      },
    },
  }
}
