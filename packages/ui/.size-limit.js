/**
 * 包体上限（《正式版架构》6.8 最后一条、6.12 的「包体 → size-limit」）。
 *
 * 量的是**这个包自己**有多大：从包入口 `src/index.ts` 整个打一遍（esbuild），
 * 压缩之后和下面的 `limit` 比。超了 `pnpm --filter @ai-duel/ui size` 就红，
 * CI 快档的 check 那个 job 会跑它（见 .github/workflows/ci.yml）。
 *
 * 压缩口径是 **brotli**（size-limit 13 的默认值，也是 Cloudflare 实际发出去的那一档），
 * 不是 gzip——同一份代码 brotli 比 gzip 小一成左右，所以这个数不能拿去和别处的 gzip 数比。
 *
 * 每个组件的 `.css` **算在里面**：esbuild 把它们和 JS 一起打进同一份产物
 *（往 button.css 里塞 10 KB 规则，量出来的数会跟着涨半 KB，验过）。
 * 这正是我们想要的——样式和组件是一体的，光量 JS 会让「样式表越写越厚」这件事查不出来。
 *
 * ## 为什么 react 不算在里面
 *
 * `react` / `react-dom` 是**壳**带的：整个应用只有一份，而且组件库用多用少都不影响它的大小。
 * 算进来的话这条上限的九成是 React 的体积，组件库自己胖了两倍也看不出来。
 * `@ai-duel/design` 反过来要算：那是这个包自己引进来的 CSS 变量表和令牌对象。
 *
 * ## 上限怎么定
 *
 * 按实测值 ×1.5 取整（第 31 条落地时实测 5.4 KB，×1.5 是 8.1，取 8 KB）。
 * 留五成余量是为了「加一两个组件不用天天改这个数」，而真要翻倍地长时它拦得住。
 * 顶破了先看是不是引进了不该引的依赖，再考虑抬这个数——每抬一次就要在这里写清为什么。
 */

export default [
  {
    name: '组件库全部导出（brotli，不含 react）',
    path: 'src/index.ts',
    /*
     * `import: '*'` 是「整包都要」的意思。不写的话 size-limit 默认按 tree-shaking
     * 之后的结果算，而这个包的每个组件都 import 了自己的 .css——那些 CSS 有副作用、
     * 摇不掉，算出来的数会和「界面真的用了几个组件」耦合在一起，一改界面这个数就动。
     */
    import: '*',
    ignore: ['react', 'react-dom'],
    limit: '8 KB',
  },
]
