/**
 * 卡面那套颜色，外加两个小工具：十六进制转数、按 CSS `color-mix` 的算法调色。
 *
 * ## 为什么这张表在这儿而不在 `@ai-duel/design`
 *
 * 正式版简化第 5 步把颜色那组令牌整组删了（理由见那个包的 README）：React 那边剥成素方块
 * 之后一条 `var(--…)` 都不读，画布上剩下的颜色只服务卡面和几层全屏遮罩。
 * 按那个包「明确不收什么」的判据，这些值该**集中成一张常量表留在组件这一侧**，
 * 每条注明抄自旧样式的哪一条规则。两个以上的文件在读的放这张表里，只有一处读的留在那一处。
 * 重做视觉时会重新定一套色板，那时再决定哪些值值得收回令牌。
 *
 * 为什么要有它：黑客松版的卡面有一批颜色是**调出来的**而不是写死的
 *（雕花铭牌的金属色 = `color-mix(in srgb, 金 35%, 纸面深线)`，
 * 费用章盘底 = `color-mix(in srgb, 插画主色 52%, 纸面墨色)`）。
 * CSS 能直接写 `color-mix`，Pixi 不能，所以那一步搬到运行期来算。
 * 抄成调好的字面值也行，但那样改一个色板令牌就要手工重算一遍，迟早对不上。
 *
 * 只按 sRGB 线性插值，和 `color-mix(in srgb, …)` 的定义一致——CSS 里写的就是 srgb。
 */

/**
 * 卡面和遮罩的颜色表。两个以上的文件在读的才放这里。
 *
 * 写成 `'#rrggbb'` 字符串而不是 `0xrrggbb`：Pixi v8 两种都认，而字符串和旧样式表里的写法
 * 一模一样，回去核对时不用在脑子里转一遍进制。要数值就过一道 `hexToInt`。
 */
export const PALETTE = {
  /** 纸张底色，纸面组件的默认面。来源：黑客松版 ui/paper/paper.css 的 --paper。 */
  paperBase: '#f0ecdf',
  /** 纸上的正文字色。来源：paper.css 的 --paper-ink。 */
  paperInk: '#2e2e38',
  /** 纸面暗部，用在凹槽和次一级的底。来源：paper.css 的 --paper-shade。 */
  paperShade: '#e4ddc9',
  /** 外框，需要咬住视线的那种线。来源：paper.css 的 --paper-line-dark。 */
  paperLineDark: '#8a8270',
  /** 低饱和水彩感的主题金。雕花铭牌和费用章的金属色都从它调出来。来源：paper.css 的 --c-gold。 */
  gold: '#d9a441',
  /**
   * 卡面边缘那圈米黄：边框、羽化带和卡面底色都是它，三者一致才没有硬接缝。
   * 来源：黑客松版 styles.css 的 .card-face --card-edge-tint（原值是 rgb 分量 244 235 214）。
   */
  cardEdgeTint: '#f4ebd6',
  /** 对局界面自己的一套纸色，比全局纸张略暖一点。来源：styles.css 的 .battle --battle-paper。 */
  battlePaper: '#eee9dc',
  /** 对局纸色的暗部。来源：styles.css 的 .battle --battle-paper-shade。 */
  battlePaperShade: '#e2dbc8',
  /** 对局界面的正文字色。来源：styles.css 的 .battle --battle-ink。 */
  battleInk: '#30313b',
  /** 夜色圆章上线条和符号的颜色。来源：styles.css 的 .card-help-mark。 */
  sealMark: '#f3ead6',
} as const

/**
 * 抛硬币和英雄技能抵消这两层全屏过场的遮罩。
 *
 * 旧样式里颜色和透明度写在一起（`rgb(0 0 0 / 68%)`），Pixi 的 tint 和 alpha 是分开的两件事，
 * 所以拆成两项。68% 而不是旧版的 52%：旧版还叠一层背景模糊，去掉模糊之后补上来当补偿
 *（模糊本来担着一半「把背景推远」的活）。来源：styles.css 的 .coin-toss / .skill-cancel。
 */
export const VEIL = { color: '#000000', alpha: 0.68 } as const

/** '#rrggbb' → 0xrrggbb。Pixi 的 tint 和 fill 都吃数，上面那张表存的是字符串。 */
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

/** 同 `mix`，但两个颜色都写成 '#rrggbb'（上面那张表就是这个形状）。 */
export function mixHex(a: string, ratio: number, b: string): number {
  return mix(hexToInt(a), ratio, hexToInt(b))
}
