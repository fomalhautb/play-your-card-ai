import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * Steam 壳的冒烟用例（《正式版架构》6.11：「构建能过本身就是测试，平台壳最容易在没人看的时候坏掉」）。
 *
 * 和另外两份 Playwright 配置（组件目录页、端到端）都不一样：这边不起任何服务器，
 * 也不开浏览器——Playwright 自己把 Electron 拉起来，用例拿到的是主进程和窗口那两个句柄。
 * 所以没有 `webServer`、没有 `projects`、也没有视口（窗口大小由壳自己定，见 src/window.ts）。
 *
 * 要用的产物由 `globalSetup` 现打（图集 + 壳的构建），第一次跑会慢一两分钟。
 */

/*
 * 用 `__dirname` 而不是 `import.meta.url`：这个包是 CommonJS（没有 `"type": "module"`，
 * 理由见 tsconfig.json），Playwright 会按 CJS 加载配置和用例，
 * 那里面 `import.meta` 直接是语法错。e2e 目录下三个文件都是这个原因。
 */
const HERE = __dirname

export default defineConfig({
  testDir: HERE,
  testMatch: /.*\.spec\.ts/,
  /*
   * 一条用例要等 Electron 冷启动加上首页那十几张整幅图装完。
   * 本机实测十几秒，跑机慢一档会翻倍，留到两分钟。
   */
  timeout: 120_000,
  // 就一条用例，而且它独占一个 Electron 实例（壳自己还有单实例锁，见 src/main.ts）。
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  globalSetup: resolve(HERE, 'globalSetup.ts'),
})
