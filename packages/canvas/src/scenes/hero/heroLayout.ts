/**
 * 选英雄页两档版式。和首页、对局那两档一样，**只输出数、不碰 Pixi 对象**，
 * 所以两档几何在 vitest 里直接断言得了。
 *
 * 两档的分岔在**分几排**：
 *
 * - 桌面档 4 + 3（设计稿上就是这样：第一排四张、第二排三张居中）；
 * - 手机档 3 + 2 + 2。竖屏 390 宽里排四张的话一张只有 87 宽、卡面上的字全糊了；
 *   而 3 + 3 + 1 的最后一排孤零零一张，看着像掉了一张。
 *
 * 这不是缩放关系：两档的排数、每排几张、卡多大都是各算各的（需求第 3 条）。
 * 详情浮层的两栏（卡在左、说明在右）同样分两档——窄屏摆不下两栏，改成上下摞。
 */

import { pickTier } from '../duel/layout/pickLayout'
import type { LayoutTier } from '../duel/layout/types'

/** 人物卡的长宽比（素材 768×1152）。 */
const CARD_RATIO = 1152 / 768

/** 桌面档：每排几张、卡占多宽、各处留白（占视口的比例）。 */
const DESKTOP = {
  rows: [4, 3],
  gap: 0.018,
  sideMargin: 0.06,
  topMargin: 0.2,
  bottomMargin: 0.08,
  titleY: 0.1,
  titleSize: 0.05,
  subtitleY: 0.155,
  subtitleSize: 0.022,
  /** 详情浮层：卡停在视口横向的哪一处，说明栏占多宽。 */
  detailAnchorX: 0.32,
  detailInfoWidth: 0.3,
} as const

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
  width: number
  height: number
  /** 七张卡各自的盒子，顺序和英雄表一致。 */
  cards: HeroRect[]
  title: { x: number; y: number; fontSize: number }
  subtitle: { x: number; y: number; fontSize: number }
  /** 左上角那颗返回。 */
  back: { x: number; y: number; fontSize: number }
  /** 右上角那颗静音圆章。 */
  seal: HeroRect
  detail: {
    /** 放大的卡停在视口横向的哪一处（0~1），交给 RevealOverlay 的 `anchorX`。 */
    anchorX: number
    /** 卡放大到多少倍（相对卡面基准宽 150）。 */
    scale: number
    /** 说明栏的盒子。 */
    info: HeroRect
    /** 详情底部那两颗匾额的尺寸档和落点。 */
    buttons: { y: number; gap: number; width: number; height: number }
  }
}

export function pickHeroLayout(width: number, height: number, coarsePointer = false): HeroLayout {
  return pickTier(width, height, coarsePointer) === 'mobile'
    ? build(width, height, MOBILE, 'mobile')
    : build(width, height, DESKTOP, 'desktop')
}

/** 两档只是常量不同，排版算法是同一套，所以合成一个函数。 */
function build(
  width: number,
  height: number,
  spec: typeof DESKTOP | typeof MOBILE,
  tier: LayoutTier,
): HeroLayout {
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
  let y = top + (gridHeight - rowsHeight) / 2
  const cards: HeroRect[] = []
  for (const count of spec.rows) {
    const rowWidth = count * cardWidth + (count - 1) * gap
    let x = (width - rowWidth) / 2
    for (let i = 0; i < count; i += 1) {
      cards.push({ x, y, width: cardWidth, height: cardHeight })
      x += cardWidth + gap
    }
    y += cardHeight + gap
  }

  const infoWidth = width * spec.detailInfoWidth
  // 放大的卡按视口高定：让它占大约六成高，两档都看得清又不顶到上下边。
  const detailCardHeight = height * 0.62
  const detailScale = detailCardHeight / (150 * CARD_RATIO)
  const buttonWidth = Math.min(width * 0.3, 288)

  return {
    tier,
    width,
    height,
    cards,
    title: { x: width / 2, y: height * spec.titleY, fontSize: height * spec.titleSize },
    subtitle: {
      x: width / 2,
      y: height * spec.subtitleY,
      fontSize: height * spec.subtitleSize,
    },
    back: { x: side, y: height * 0.05, fontSize: Math.max(14, height * 0.022) },
    seal: {
      x: width - side - width * 0.045,
      y: height * 0.045,
      width: width * 0.045,
      height: width * 0.045,
    },
    detail: {
      anchorX: spec.detailAnchorX,
      scale: detailScale,
      info: {
        x:
          tier === 'mobile'
            ? (width - infoWidth) / 2
            : width * spec.detailAnchorX + detailCardHeight / CARD_RATIO / 2 + width * 0.04,
        // 手机档说明摞在卡下面，桌面档和卡上沿齐平。
        y: tier === 'mobile' ? height * 0.62 : height * 0.24,
        width: infoWidth,
        height: tier === 'mobile' ? height * 0.24 : height * 0.52,
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
