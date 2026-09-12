/**
 * 徽章类零件的模具和尺寸：费用圆章、卡面铭牌带、夜色圆章、角标药丸。
 *
 * 前两个原本长在 `bakedTextures.ts` 里、只服务卡牌，但需求单把它们记成了独立变体
 *（徽章 A 费用圆章、徽章 C 卡面铭牌），组牌页和结算层也要单独用。搬到这里之后
 * 全项目只有一份定义：`fx/bakedTextures.ts` 烤进卡牌那张合成纹理时用它，
 * `components/Badge.ts` 单独用一枚时也用它——两处的形状不可能走岔。
 *
 * 注意搬的是**形状**不是显示对象。卡牌上的那一枚不能直接换成 Badge 组件：
 * 卡面的每一层都是过透视投影的四边形网格（见 CardSprite 的文件头），
 * 而 Badge 是一个普通容器，挂上去就没有近大远小了。
 */

import { tokens } from '@ai-duel/design'
import { Graphics } from 'pixi.js'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'
import { type Mold, mold } from './mold'

/** 卡面铭牌带的高度（卡面基准尺寸下的像素），名字印在里面。 */
export const NAMEPLATE_HEIGHT = 30

/**
 * 费用圆章的直径：卡宽的 20.8%，150 宽的卡上就是 31.2。
 *
 * 来源是旧客户端 `ui/cardFaceOverlay.css` 里 `.card-overlay__cost` 的 `width: 20.8%`
 * （那枚章按卡宽取百分比，技能牌原画上烘焙的那枚实测占 16%，取它的 1.3 倍）。
 * 一并见 docs/design/card-face-overlay.md：直径全场统一，只有圆心逐张配。
 *
 * 以前写死 38，配下面那个圆心会让圆章往左、往上各探出卡外 2.5~3px——
 * 卡面的圆角是烤进图集 alpha 的，探出去的那一块没有卡面接着，看着就是浮在卡外的一枚章。
 * 按 20.8% 取之后半径 15.6，小于圆心到卡上沿的 15.975，整枚章连描边都落在圆角矩形里。
 */
export const COST_BADGE_SIZE = CARD_WIDTH * 0.208

/**
 * 费用圆章的圆心离卡面左上角的距离。
 *
 * 旧版是**逐张配**的：每张原画左上角自己画了一枚星章，圆章要盖住它，而各张星章的位置
 * 都不一样（见 legacy-client/src/ui/aiModelFace.ts 的 costBadge）。那是内容数据，
 * 该跟着卡面一起从 content 包来；接上之前这里先用那批百分比的中位数当统一默认值
 * （约 11% / 7.1%）。换成逐张配之后要重新确认每张都还落在圆角矩形内。
 */
export const COST_BADGE_CENTER = { x: CARD_WIDTH * 0.11, y: CARD_HEIGHT * 0.071 }

/**
 * 费用圆章的盘底：一枚实心圆加两圈描边，数字由调用方另外贴一张文字纹理上去。
 *
 * 盘底画成白色，用的时候按各张牌的主色 tint——旧版是每张原画角上自带一枚星章、
 * 圆章要盖住它，所以颜色跟着原画走。
 */
export function drawCostBadge(): Graphics {
  const g = new Graphics()
  const r = COST_BADGE_SIZE / 2
  /*
   * 三圈的半径和线宽都按半径取比例，不写死像素：直径是从卡宽算出来的（COST_BADGE_SIZE），
   * 卡宽一改这几圈得跟着缩，写死的话小尺寸上外圈会粗得像个铁环。
   * 比例沿用直径 38 那一版的观感（盘面 0.947r、外圈 0.921r 线宽 0.105r、内细线 0.737r）。
   */
  g.circle(r, r, r * 0.947).fill({ color: 0xffffff })
  g.circle(r, r, r * 0.921).stroke({
    width: r * 0.105,
    color: tokens.color.battle.ink,
    alpha: 0.65,
  })
  g.circle(r, r, r * 0.737).stroke({ width: r * 0.053, color: 0xffffff, alpha: 0.55 })
  return g
}

/**
 * 卡面下部那条铭牌带：一块压住原画的不透明纸底，上沿压一条细线。
 *
 * 画进调用方给的 Graphics 而不是自己新建一个，是因为它在卡牌上和边框是**同一张**烤纹理
 *（见 bakedTextures 的 drawCardChrome）：拆成两张会多一次绘制，也多一次合批打断。
 * @param top 铭牌带上沿在这个坐标系里的 y。
 */
export function drawNameplateBand(g: Graphics, top: number, lineColor: string): void {
  g.roundRect(6, top, CARD_WIDTH - 12, NAMEPLATE_HEIGHT, CARD_RADIUS - 6).fill({
    color: tokens.color.battle.paper,
    alpha: 0.94,
  })
  g.moveTo(10, top)
    .lineTo(CARD_WIDTH - 10, top)
    .stroke({ width: 1, color: lineColor, alpha: 0.5 })
}

/** 单独一枚铭牌（徽章 C）：卡宽那么宽的一条，原点在左上角。 */
export function drawNameplate(): Mold {
  const g = new Graphics()
  drawNameplateBand(g, 0, tokens.color.battle.lineDark)
  return mold(CARD_WIDTH, NAMEPLATE_HEIGHT + 1, g)
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
