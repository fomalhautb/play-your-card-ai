/**
 * 徽章类零件的模具和尺寸：卡面的费用圆章、夜色圆章、角标药丸。
 *
 * 费用圆章原本长在 `bakedTextures.ts` 里、只服务卡牌，搬到这里之后全项目只有一份定义。
 * 卡面铭牌从前也在这儿（需求单的徽章 C），正式版简化第 4 步之三把卡面的名字条换成了
 * 八角雕花匾（见 `fx/cardPlaque.ts`），素纸条那一版连同 `Badge` 的 A / B / C 三个变体
 * 一起不再用——卡上的每一层都要过透视投影，普通容器挂上去就没有近大远小了。
 *
 * 注意这里只有**形状**，不是显示对象。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { CARD_WIDTH } from '../layout/fanMath'
import { mixHex } from './colors'
import { type Mold, mold } from './mold'

/**
 * 费用圆章的直径：卡宽的 20.8%，150 宽的卡上就是 31.2。
 *
 * 来源是黑客松版 `ui/cardFaceOverlay.css` 里 `.card-overlay__cost` 的 `width: 20.8%`
 * （那枚章按卡宽取百分比，技能牌原画上烘焙的那枚实测占 16%，取它的 1.3 倍）。
 * 一并见 docs/design/card-face-overlay.md：直径全场统一，只有圆心逐张配。
 */
export const COST_BADGE_SIZE = CARD_WIDTH * 0.208

/**
 * 圆章模具的画布边长。
 *
 * 按 100 画是为了能照抄黑客松那段 SVG 的 `viewBox="0 0 100 100"`——三圈半径、两道弧线、
 * 两行字的位置逐点对得上。它显示出来只有 31.2，看着像烤大了，其实正合适：
 * 放大查看时这枚章会被放到 2.2 倍、再乘 1.5 的渲染倍率，约 103 个设备像素。
 */
const BADGE_VIEW = 100

/** 模具画布到实际直径的倍数，摆字的时候按它把 SVG 里的坐标换算过去。 */
const BADGE_SCALE = COST_BADGE_SIZE / BADGE_VIEW

/**
 * 费用圆章圆心的兜底位置：`x` 按卡宽、`y` 按卡高的百分比。
 *
 * 逐张配的那份数据在 `@ai-duel/content` 的 `CARD_FACES`（canvas 不许依赖 content，
 * 由装配层传进来，见 `scenes/duel/cardVisuals.ts`）。这里这个兜底值是黑客松
 * `cardFaceOverlay.css` 里 `--cost-x / --cost-y` 的默认值，也就是 24 张技能牌原画上
 * 那枚章的常见位置。查不到配置的牌（目录页的样例卡、缺数据的牌）用它。
 */
export const DEFAULT_COST_BADGE_CENTER = { x: 13.9, y: 9.2 } as const

/**
 * 圆章上两段字的排版，坐标换算成「以圆章左上角为原点的像素」。
 *
 * 数全部来自黑客松那段 SVG：数字基线 y=62、一位数 60 号两位数 48 号；
 * `TOKEN` 基线 y=80、15 号。基线换算成"视觉中心"要抬 0.35 倍字号，同 `fx/cardPlaque.ts`。
 */
export const COST_BADGE_TEXT = {
  number: {
    single: lineOf(60, 62),
    /** 两位数要小一号才排得进最里面那圈细线。 */
    double: lineOf(48, 62),
  },
  unit: lineOf(15, 80),
} as const

function lineOf(fontSize: number, baseline: number): { fontSize: number; centerY: number } {
  return {
    fontSize: fontSize * BADGE_SCALE,
    centerY: (baseline - fontSize * 0.35) * BADGE_SCALE,
  }
}

/**
 * 费用圆章的**盘底**：一枚实心圆，画成白的，用的时候按各张牌的盘底色 tint。
 *
 * 盘底和上面的金属圈拆成两张纹理，是因为只有盘底逐张变色：AI 牌按插画主色调
 *（`color-mix(accent 52%, 纸面墨色)`），技能牌用从原画那枚章上采下来的颜色。
 * 合成一张的话 tint 会把金属圈也一起染了。
 */
export function drawCostDisc(): Mold {
  const r = BADGE_VIEW / 2
  return mold(BADGE_VIEW, BADGE_VIEW, new Graphics().circle(r, r, r).fill({ color: 0xffffff }))
}

/**
 * 费用圆章的**三圈金属环加上下两道弧线**。
 *
 * 三圈的半径和线宽照抄黑客松那段 SVG（r 48 / 44 / 40.5，线宽 2.5 / 1 / 0.6），
 * 上下那两道弧是章面上的装饰，少了它这枚章就只是三个同心圆。
 * 颜色全场一样，所以画的是真颜色而不是白色——这一层没有逐张上色的需求。
 */
export function drawCostRings(): Mold {
  const metal = mixHex(tokens.color.theme.gold, 0.35, tokens.color.paper.lineDark)
  const metalLight = mixHex(tokens.color.paper.base, 0.76, tokens.color.theme.gold)
  const r = BADGE_VIEW / 2
  const g = new Graphics()
  g.circle(r, r, 48).stroke({ width: 2.5, color: metal })
  g.circle(r, r, 44).stroke({ width: 1, color: metalLight })
  g.circle(r, r, 40.5).stroke({ width: 0.6, color: metal })
  g.moveTo(22, 16).quadraticCurveTo(50, 0, 78, 16).stroke({ width: 1, color: metalLight })
  g.moveTo(22, 84).quadraticCurveTo(50, 100, 78, 84).stroke({ width: 1, color: metalLight })
  return mold(BADGE_VIEW, BADGE_VIEW, g)
}

/** 夜色圆章模具的采样直径。用的时候会缩到 22~52，按 64 烤在高分屏上也够。 */
const SEAL_SIZE = 64

/** 夜色圆章的底：一枚实心圆。 */
export function drawSealDisc(): Mold {
  const r = SEAL_SIZE / 2
  return mold(SEAL_SIZE, SEAL_SIZE, new Graphics().circle(r, r, r).fill({ color: 0xffffff }))
}

/**
 * 夜色圆章的外圈。
 *
 * 旧版特意不用 CSS 的 border 而是自己画一圈，理由是「border 抖不起来，会和圈里的问号对不上」
 *（手绘滤镜只作用在图形上）。这里不挂滤镜，单独一层是为了它和底色能分别上色。
 * 线宽按直径取比例：这一枚会被缩到 22 也会被放到 52，写死像素的话小尺寸上粗得像个铁环。
 */
export function drawSealRing(): Mold {
  const r = SEAL_SIZE / 2
  const width = SEAL_SIZE * 0.045
  const g = new Graphics().circle(r, r, r - width).stroke({ width, color: 0xffffff })
  return mold(SEAL_SIZE, SEAL_SIZE, g)
}

/**
 * 药丸的基准尺寸。高度固定 20，所以九宫格的上下两条边加起来就是整高、中间那行是零高，
 * 拉伸只发生在横向——圆头永远是正圆，不会被拉成椭圆。
 */
export const PILL_BASE = { width: 40, height: 20 }
/** 九宫格四条边的宽度，就是圆头的半径。 */
export const PILL_INSET = PILL_BASE.height / 2

/** 角标药丸的底。 */
export function drawPillFill(): Mold {
  const { width, height } = PILL_BASE
  const g = new Graphics().roundRect(0, 0, width, height, PILL_INSET).fill({ color: 0xffffff })
  return mold(width, height, g)
}

/** 角标药丸的描边。描边画在内侧半个线宽处，才不会被取景框切掉半条。 */
export function drawPillLine(): Mold {
  const { width, height } = PILL_BASE
  const g = new Graphics()
    .roundRect(0.5, 0.5, width - 1, height - 1, PILL_INSET - 0.5)
    .stroke({ width: 1, color: 0xffffff })
  return mold(width, height, g)
}
