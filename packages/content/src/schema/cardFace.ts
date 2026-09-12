import { z } from 'zod'
import type { CardFaceStyle } from '../cardFaces'

/**
 * 卡面展示配置的 schema。
 *
 * 单独一个文件而不是塞进 `card.ts`：那边守的是玩家要据此决策的规则数据（费用、效果、进化链），
 * 每条都钉在 core 的类型上；这边守的是纯展示数据，core 里没有对应的类型，
 * 混在一起会让「改了会影响对局吗」这个问题变难回答。
 */

/**
 * 颜色统一写成小写 `#rrggbb`。
 *
 * 不收 `#rgb` 简写、不收 `rgb()` 和颜色名：这些值要交给 Pixi 当数值用
 *（展示层拿 `parseInt(hex.slice(1), 16)` 转），多一种写法就多一处要解析的分支。
 */
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, '颜色要写成小写的 #rrggbb')

/**
 * 圆心坐标是百分比，取值 0~100。
 *
 * 上下界顺带把 NaN 和 Infinity 挡在外面——它们一路传到展示层会算出 NaN 坐标，
 * 圆章直接从画面上消失，而且不报错。
 */
const badgePercentSchema = z
  .number()
  .min(0, '圆心百分比不能是负数')
  .max(100, '圆心百分比不能超过 100')

/** 一张卡的卡面配置。字段含义见 `src/cardFaces.ts` 的 `CardFaceStyle`。 */
export const cardFaceStyleSchema = z
  .object({
    accent: hexColorSchema.optional(),
    costFill: hexColorSchema.optional(),
    costBadge: z
      .object({
        x: badgePercentSchema,
        y: badgePercentSchema,
      })
      .optional(),
  })
  .refine((style) => style.accent !== undefined || style.costFill !== undefined, {
    // 两个都缺的话费用圆章没有盘底色可用：AI 牌靠 accent 掺出来，技能牌直接用 costFill。
    // 空对象在类型上是合法的 CardFaceStyle，所以只能在这儿拦。
    message: 'accent 和 costFill 至少要有一个，否则费用圆章调不出盘底色',
  }) satisfies z.ZodType<CardFaceStyle>

/**
 * 整张卡面表。
 *
 * 另外两条规则——键不能有 `CARDS` 里没有的卡、AI 牌必须有 `accent` 而技能牌必须有
 * `costFill`——不放在这里，放在 `test/cardFaces.test.ts` 里断言：
 * 两条都要查卡表才成立，而 schema 目录一向只依赖 core 的类型，不 import 任何一张数据表
 *（反过来 import 会让「谁守着谁」绕成一个圈）。
 */
export const cardFaceTableSchema = z.record(z.string().min(1), cardFaceStyleSchema)
