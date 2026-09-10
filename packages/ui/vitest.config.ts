/**
 * 跑在 happy-dom 里：这个包整个就是 React 组件，没有 DOM 什么都测不了
 *（和 `client`、`platform` 那两份 node 环境的配置正好相反，那边刻意不给 DOM）。
 *
 * 测的是**逻辑**：按钮禁用时点不动、对话框三条关闭路径通不通、按钮在不在文档里。
 * 长什么样不在这里测——那是组件目录页截图回归的活（6.8），
 * 而 happy-dom 根本不排版，量出来的尺寸全是 0。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.tsx'],
    environment: 'happy-dom',
    /*
     * CSS 一律不处理。组件里的 `import './button.css'` 在这里被当成空模块，
     * 测试也不看样式；真处理一遍只是白花时间，还会因为 CSS 变量在 happy-dom 里
     * 解析不出值而误导人以为「样式测到了」。
     */
    css: false,
  },
})
