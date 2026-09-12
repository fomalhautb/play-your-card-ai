/**
 * 跑在 node 环境，不给 DOM。
 *
 * 这不是随便选的：driver 和网络层该走的是 `platform` 的能力接口，一个浏览器对象都不该碰。
 * 环境里根本没有 window 才验得出这一点——真漏了一处会直接报 window is not defined，
 * 而不是在 happy-dom 里悄悄跑过去（照抄 packages/platform 的口径）。
 *
 * 界面组件的测试将来要 DOM，那时给那几个文件单独在文件头写一行 vitest 的环境指令。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
