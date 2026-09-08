/**
 * `pnpm test` 只跑 Node 侧的纯逻辑：计数器差分、阈值比较、trace 解析。
 *
 * include 写死 test/ 目录，把 tests/ 下的 Playwright 用例挡在外面——
 * 两边都叫 spec/test，不挡的话 vitest 会去加载 @playwright/test 然后拉起浏览器，
 * 而 CI 快档的十分钟预算不打算花在这上面（见 .github/workflows/ci.yml）。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
