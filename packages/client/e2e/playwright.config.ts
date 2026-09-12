/**
 * 端到端用例的跑批器配置（《正式版架构》6.11「单机模式一条」那一条的雏形）。
 *
 * 和组件目录页那份（dev/storybook/playwright.config.ts）是两套：那边起的是 Storybook、
 * 拍的是截图；这边起的是真的 `apps/web` 开发服务器，走的是玩家真会走的那条路
 *（首页 → 测试对局 → 打完 → 结算页）。两份的端口、testDir 和超时都不一样，
 * 合成一份只会让「跑哪一套」变成一堆条件判断。
 *
 * CI 的快档暂时不接这一条（慢档是第 37 条的事），但它必须能在本机一条命令跑起来：
 * `pnpm --filter @ai-duel/client e2e`。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根：本文件在 packages/client/e2e 下，往上三层。 */
const REPO_ROOT = resolve(HERE, '../../..')

/**
 * 开发服务器的端口。
 *
 * 和 `pnpm dev` 那份（5174）错开：手边开着开发服务器的同时还能跑端到端，
 * 两边各起各的，谁也不占谁。
 */
const PORT = 5178
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: HERE,
  testMatch: /.*\.spec\.ts/,
  /*
   * 一条用例要打完一整局。本机实测 1 分多钟，其中大头是两段等待：
   * 找一张现在打得出去的手牌（每试一张要等满 2.5 秒的演出锁兜底），
   * 以及 8 轮里每轮 2.5 秒的自动交卷。跑机慢一档就会翻倍，所以留到 5 分钟。
   */
  timeout: 300_000,
  // 用例之间共用同一个开发服务器，但各自会重开一局，并行没有意义也容易互相干扰。
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // 桌面档版式：视口短边 900 > 断点 768，走的是有侧栏的那一档（见 canvas 的 pickLayout）。
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        headless: true,
        launchOptions: {
          args: [
            /*
             * 走 ANGLE 的 SwiftShader 后端，同目录页那份的理由：
             * 没有独显的跑机也能跑 WebGL，而对局界面整个画在画布上，没有 WebGL 就什么都看不见。
             */
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
  ],
  // 图集不在就先打一份，和目录页那份共用同一个 setup（它只认 apps/web/public/atlas）。
  globalSetup: '../dev/storybook/ensureAtlas.ts',
  webServer: {
    command: `pnpm --filter @ai-duel/web dev --port ${PORT}`,
    cwd: REPO_ROOT,
    url: BASE_URL,
    /*
     * 不复用已经在跑的服务器。端口是写死的，另一个工作树里开着同一个端口的话
     * 这边会直接连上去——跑的是那份代码，而且全程没有任何提示。
     * 宁可让它因为端口被占直接失败（和目录页那份同一个决定）。
     */
    reuseExistingServer: false,
    // 冷启动要让 Vite 预构建 pixi、gsap、react 那几个大包，两分钟是本机实测的三倍余量。
    timeout: 180_000,
  },
})
