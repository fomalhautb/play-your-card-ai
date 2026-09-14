/**
 * 具名 AI 牌卡面下部那块**八角雕花匾**：纸底 + 三圈金属描边 + 四角卷草，
 * 上面印两行字（技能名在上、模型名在下）。
 *
 * 形状原样抄黑客松版的 `ui/CardFaceOverlay.tsx`：那边是一段 760×230 的 SVG，
 * 这里把同样几条路径喂给 Pixi 的 `GraphicsPath`（它认 SVG 的 `d` 字符串），
 * 所以两版的匾在几何上是同一份，改动可以逐点对照。
 *
 * 这块匾不自己占一层，而是**画进卡面那张边框纹理里**（见 fx/cardShapes.ts 的
 * `drawCardChrome`）。两个理由，后一个是硬的：
 * 一是十八张 AI 牌的匾长得一模一样、位置也一样，本来就该和边框一起当成"每张牌都有的那一层"；
 * 二是过度绘制（3.2）——那条指标按**包围盒**算，单独一层就是在整张原画之上再铺一块
 * 卡面 13% 大的实心，一屏二三十张卡（构筑页）加起来就把预算顶穿了。
 *
 * 代价是匾上的颜色不能逐张变——黑客松那层最外圈的阴影描边调了插画主色
 *（`--card-ink` = `color-mix(accent 30%, 纸面墨色)`），这里统一用纸面墨色。
 * 那一档只有 24% 不透明度、又压在金属圈底下，逐张差别本来就看不出来。
 * 匾上那两行字仍然逐张上色，它们本来就是各自一层。
 */

import { tokens } from '@ai-duel/design'
import { type Graphics, GraphicsPath } from 'pixi.js'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import { mixHex } from './colors'

/** 黑客松那段 SVG 的画布尺寸，下面所有坐标都按它写。 */
const VIEW = { width: 760, height: 230 } as const

/** 匾左右各离卡边多远、底边离卡底多远。抄 `.card-overlay__plaque` 的 `right/left 10%; bottom 4.5%`。 */
const INSET = { side: 0.1, bottom: 0.045 } as const

/** 两行字在 760×230 那张画布上的字号和**基线** y，抄 `.card-overlay__skill / __name`。 */
const LETTERING = {
  skill: { fontSize: 40, baseline: 89, maxLength: 560 },
  name: { fontSize: 76, baseline: 171, maxLength: 610 },
} as const

/**
 * 从基线换算到"这行字的视觉中心"要往上抬多少，按字号的比例取。
 *
 * 卡面这边摆的是一张**烤好的文字纹理**，它按中心定位；SVG 那边给的是基线。
 * 0.35 倍字号是西文加中文混排时基线到视觉中心的常用近似，两行都用同一个数，
 * 行距关系才和原版一致。
 */
const BASELINE_TO_CENTER = 0.35

/** 匾在卡面上的落位和两行字的排版，坐标全是卡面基准尺寸（150×225）下的像素。 */
export const CARD_PLAQUE = plaqueLayout()

/** 一行字该多大、中心摆在哪、最宽不能超过多少。 */
export interface PlaqueLine {
  fontSize: number
  /** 中心离匾顶边多少像素。 */
  centerY: number
  /** 整行最宽多少像素，超了就整体压窄（对应 SVG 的 `textLength`）。 */
  maxWidth: number
}

function plaqueLayout(): {
  width: number
  height: number
  /** 匾的顶边离卡底边多少像素（正数，往上量）。 */
  top: number
  skill: PlaqueLine
  name: PlaqueLine
} {
  const width = CARD_WIDTH * (1 - INSET.side * 2)
  const scale = width / VIEW.width
  const height = VIEW.height * scale
  const lineOf = (line: { fontSize: number; baseline: number; maxLength: number }): PlaqueLine => ({
    fontSize: line.fontSize * scale,
    centerY: (line.baseline - line.fontSize * BASELINE_TO_CENTER) * scale,
    maxWidth: line.maxLength * scale,
  })
  return {
    width,
    height,
    top: CARD_HEIGHT * INSET.bottom + height,
    skill: lineOf(LETTERING.skill),
    name: lineOf(LETTERING.name),
  }
}

/** 匾的外轮廓：三圈描边和纸底都照它来（最外那圈）。 */
const RIM = `M90 17H347Q368 17 380 4Q392 17 413 17H670Q714 17 714 53Q748 66 748 115Q748 164 714
 177Q714 213 670 213H413Q392 213 380 226Q368 213 347 213H90Q46 213 46 177Q12 164 12 115Q12 66 46
 53Q46 17 90 17Z`
/** 第二圈：亮金属。 */
const RIM_LIGHT = `M90 23H347Q368 23 380 12Q392 23 413 23H670Q707 23 707 58Q741 72 741 115Q741
 158 707 172Q707 207 670 207H413Q392 207 380 218Q368 207 347 207H90Q53 207 53 172Q19 158 19
 115Q19 72 53 58Q53 23 90 23Z`
/** 第三圈：最里面那道细线。 */
const RIM_INNER = `M93 31H347Q368 31 380 21Q392 31 413 31H667Q697 31 697 65Q730 78 730 115Q730
 152 697 165Q697 199 667 199H413Q392 199 380 209Q368 199 347 199H93Q63 199 63 165Q30 152 30
 115Q30 78 63 65Q63 31 93 31Z`
/** 左右两侧的卷草。 */
const FLOURISH_SIDE = `M54 84C15 70 20 42 37 49C51 57 34 68 28 60M54 146C15 160 20 188 37 181C51
 173 34 162 28 170M706 84C745 70 740 42 723 49C709 57 726 68 732 60M706 146C745 160 740 188 723
 181C709 173 726 162 732 170`
/** 四角的卷须。 */
const FLOURISH_CORNER = `M87 30C65 13 50 36 65 41C76 45 78 33 73 31M673 30C695 13 710 36 695
 41C684 45 682 33 687 31M87 200C65 217 50 194 65 189C76 185 78 197 73 199M673 200C695 217 710
 194 695 189C684 185 682 197 687 199`
/** 上下居中那两颗菱形。 */
const FLOURISH_DIAMOND = 'M373 20L380 10L387 20L380 31ZM373 210L380 200L387 210L380 220Z'

/**
 * 把一整块匾（纸底 + 三圈描边 + 卷草）画进调用方的 Graphics，摆在卡面上它该在的位置。
 *
 * 坐标系是**卡面基准尺寸**（150×225，原点在卡的左上角），和 `drawCardChrome` 同一套。
 * 线宽跟着那次 `setTransform` 一起缩，所以下面的 stroke 宽度可以原样照抄 SVG 上的数。
 */
export function paintCardPlaque(g: Graphics): void {
  const metal = mixHex(tokens.color.theme.gold, 0.35, tokens.color.paper.lineDark)
  const metalLight = mixHex(tokens.color.paper.base, 0.76, tokens.color.theme.gold)
  const scale = CARD_PLAQUE.width / VIEW.width
  g.save()
  g.setTransform(
    scale,
    0,
    0,
    scale,
    (CARD_WIDTH - CARD_PLAQUE.width) / 2,
    CARD_HEIGHT - CARD_PLAQUE.top,
  )
  const rim = path(RIM)
  /*
   * 纸底直接拿外轮廓填，不另画一个圆角矩形（黑客松那边是一个单独的 div）：
   * 填的形状和描边的形状完全一致，边上才不会露出半圈纸白或者半圈空。
   */
  g.path(rim).fill({ color: tokens.color.paper.base })
  // 最外那圈粗描边是「匾投在卡面上的影子」，所以又宽又淡，压在金属圈底下。
  g.path(rim).stroke({ width: 8, color: tokens.color.paper.ink, alpha: 0.24 })
  g.path(rim).stroke({ width: 3, color: metal })
  g.path(path(RIM_LIGHT)).stroke({ width: 2, color: metalLight })
  g.path(path(RIM_INNER)).stroke({ width: 1.5, color: metal })
  const flourish = { width: 2, color: metal, cap: 'round', join: 'round' } as const
  for (const d of [FLOURISH_SIDE, FLOURISH_CORNER, FLOURISH_DIAMOND]) {
    const shape = path(d)
    g.path(shape).fill({ color: tokens.color.paper.shade })
    g.path(shape).stroke(flourish)
  }
  g.restore()
}

/** 路径常量写成多行是为了不超行宽，喂给 Pixi 之前要把换行折回去。 */
function path(d: string): GraphicsPath {
  return new GraphicsPath(d.replace(/\s+/g, ' '))
}
