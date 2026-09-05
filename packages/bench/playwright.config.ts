/**
 * 跑批器。两个 project 对应 6.9 的两类指标，默认只跑确定性那组。
 *
 * - deterministic：无头 Chromium，强制 SwiftShader 软件渲染。软件渲染慢，但它跨机器一致，
 *   而确定性指标要的正是「同一段剧本在任何机器上一模一样」。时间快慢在这一组里没有意义。
 * - timing：有头、开 GPU、真实时钟，录 Chrome trace。它默认不跑（--project 显式指定），
 *   因为它慢、要 GPU、而且在无头软件渲染的 CI 快档上量出来的时间没有参考价值。
 *
 * workers 固定为 1：两个浏览器同时抢 GPU，时间指标立刻变成噪声。
 */

import { defineConfig } from '@playwright/test'
import { BENCH_PORT } from './vite.config'

const BASE_URL = `http://127.0.0.1:${BENCH_PORT}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  // 一段剧本几百帧，软件渲染下比默认的 30 秒长。
  timeout: 180_000,
  reporter: [['list']],
  use: { baseURL: BASE_URL },
  webServer: {
    command: 'pnpm exec vite',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'deterministic',
      testMatch: /deterministic\.spec\.ts/,
      use: {
        browserName: 'chromium',
        headless: true,
        launchOptions: {
          args: [
            // 走 ANGLE 的 SwiftShader 后端：没有独显的跑机也能跑 WebGL，
            // 而且不同机器的驱动差异不会渗进确定性指标里。
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
    {
      name: 'timing',
      testMatch: /timing\.spec\.ts/,
      use: {
        browserName: 'chromium',
        // 有头才拿得到真正的 GPU 合成路径，帧时间才有意义。
        //
        // 特意不加 --disable-frame-rate-limit：关掉垂直同步之后合成器会尽力狂出帧，
        // 帧间隔变成「最快能多快」而不是「用户看到的节奏」，
        // 6.9 那条「超过预算两倍算一帧卡顿」也就永远触发不了。
        headless: false,
      },
    },
  ],
})
