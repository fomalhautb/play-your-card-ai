/**
 * 颜色的两个小工具：十六进制转数、按 CSS `color-mix` 的算法调色。
 *
 * 为什么要有它：黑客松版的卡面有一批颜色是**调出来的**而不是写死的
 *（雕花铭牌的金属色 = `color-mix(in srgb, 金 35%, 纸面深线)`，
 * 费用章盘底 = `color-mix(in srgb, 插画主色 52%, 纸面墨色)`）。
 * CSS 能直接写 `color-mix`，Pixi 不能，所以那一步搬到运行期来算。
 * 抄成调好的字面值也行，但那样改一个色板令牌就要手工重算一遍，迟早对不上。
 *
 * 只按 sRGB 线性插值，和 `color-mix(in srgb, …)` 的定义一致——CSS 里写的就是 srgb。
 */

/** '#rrggbb' → 0xrrggbb。Pixi 的 tint 和 fill 都吃数，令牌存的是给 CSS 用的字符串。 */
export function hexToInt(hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

/**
 * 按 sRGB 混两个颜色：`mix(a, ratio, b)` 等于 CSS 的 `color-mix(in srgb, a ratio%, b)`。
 *
 * @param ratio 第一个颜色占的比例（0~1）。
 */
export function mix(a: number, ratio: number, b: number): number {
  const t = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * t + ((b >> shift) & 0xff) * (1 - t))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** 同 `mix`，但两个颜色都写成 '#rrggbb'（令牌就是这个形状）。 */
export function mixHex(a: string, ratio: number, b: string): number {
  return mix(hexToInt(a), ratio, hexToInt(b))
}
