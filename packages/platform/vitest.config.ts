/**
 * 默认跑在 node 环境。
 *
 * 这不是随便选的：假实现和接口层不该碰任何浏览器 API，环境里根本没有 window
 * 才验得出这一点——真漏了一处，测试会直接报 window is not defined，
 * 而不是在 happy-dom 里悄悄跑过去。
 * 要 DOM 的那几个文件自己在头一行写 `// @vitest-environment happy-dom`。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
