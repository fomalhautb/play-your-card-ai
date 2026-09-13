/**
 * 桩场景和截图用到的几个颜色。
 *
 * 原先这些值读 `@ai-duel/design` 的颜色令牌（按《正式版架构》7.1 第 4 条「组件里不写死颜色」）。
 * 正式版简化第 5 步把颜色那组令牌整组删了（理由见 design 包的 README），这几个值跟着搬到
 * 这里——桩场景本来就不是真界面，它要的只是「每次跑出来的画面一模一样」，
 * 而关键帧基线和过度绘制那几条指标都卡着这一点：改了这里要重拍基线。
 *
 * 来源都是黑客松版的旧样式：`styles.css` 的 `:root background`、
 * `ui/paper/paper.css` 的 `--night` / `--paper` / `--c-purple`。
 */
export const BENCH_COLORS = {
  /** 页面底色，舞台之外露出来的那一圈。渲染器的 background 和截图的 clearColor 必须同一个数。 */
  pageBackground: '#0d1117',
  /** 桩场景的深色底。 */
  paperNight: '#323d57',
  /** 桩场景里卡面的字色和卡边的那圈纸白。 */
  paperBase: '#f0ecdf',
  /** 全屏泛光那一层的颜色（只有高画质档有）。 */
  themePurple: '#9186bd',
} as const
