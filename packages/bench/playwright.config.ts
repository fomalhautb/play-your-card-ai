/**
 * 跑批器。两个 project 对应 6.9 的两类指标，默认只跑确定性那组。
 *
 * - deterministic：无头 Chromium，强制 SwiftShader 软件渲染。软件渲染慢，但它跨机器一致，
 *   而确定性指标要的正是「同一段剧本在任何机器上一模一样」。时间快慢在这一组里没有意义。
 * - timing：有头、开 GPU、真实时钟，录 Chrome trace。它默认不跑（--project 显式指定），
 *   因为它慢、要 GPU、而且在无头软件渲染的 CI 快档上量出来的时间没有参考价值。
 *
 * 两组对并发的要求正相反，所以并行只开在 deterministic 那个 project 上，见下面各自的说明。
 */

import { availableParallelism } from 'node:os'
import { defineConfig } from '@playwright/test'
import { BENCH_PORT } from './vite.config'

const BASE_URL = `http://127.0.0.1:${BENCH_PORT}`

/**
 * 开几个 worker。
 *
 * SwiftShader 的光栅化自己是多线程的，一个页面跑起来就占掉约三个核，
 * 所以按核数的三分之一取：再往上加只是让几个 worker 互相抢核，墙钟时间不降反升。
 * CI 上写死 2：容器里 availableParallelism() 报的常常是宿主机的核数，按它算会开得太多。
 */
const WORKERS = process.env.CI ? 2 : Math.max(1, Math.floor(availableParallelism() / 3))

export default defineConfig({
  testDir: './tests',
  /*
   * 顶层不开：不开的时候同一个 spec 文件里的用例算一个整体，由一个 worker 串着跑。
   * timing 那组要的正是这个——它有头、量的是帧时间，两个浏览器同时抢 GPU，数字立刻变成噪声；
   * 它只有一个 spec 文件，所以哪怕 workers 大于 1，实际也只会占用一个 worker。
   * 确定性那组在自己的 project 上单独开（见下面）。
   */
  fullyParallel: false,
  workers: WORKERS,
  /*
   * 单条用例 15 分钟。
   *
   * 这个数是被 SwiftShader 顶上来的：桌面档 1920×1080 按 1.5 倍渲染就是 2880×1620，
   * 软件光栅在这个分辨率上是填充率绑定的（画多少像素就花多少时间），
   * 而每条用例要把同一段剧本跑三轮——逐帧记录一轮、关掉记录做堆采样一轮、
   * 再重跑一轮验两遍完全一致。
   *
   * 迁移第 18 条接上真对局场景之后这个数从 8 分钟提到了 15 分钟，原因是剧本变长了：
   * `play10` 现在打的是一局真对局，一张一张打、每张等演出收完再打下一张，
   * 十张连打覆盖约 26 秒的演出，一轮就是 1589 帧（原型那版只有四百来帧）。
   * 这台 M2 上最慢的一条（desktop/play10）单独跑 6.8 分钟。
   *
   * 之所以不是 7 分钟：并行之后同一条用例会变慢。SwiftShader 是纯 CPU 的，
   * 几个 worker 一起跑就在抢同一批核（M2 八个逻辑核里只有 4 个是性能核）。
   * 超时要按「并行时的最慢一条」给，不是按单独跑的：desktop/play10 单独跑 6.8 分钟，
   * 跑整批时实测 12.9 分钟（慢 1.9 倍），按 8 分钟给会当场超时，所以取整到 15。
   * 整批八条并行跑完 17 分钟，desktop/play10 一条就占了其中的 12.9 分钟。
   * 要再快只能少跑一轮、缩短剧本或者降分辨率，那三样都是改口径，另议。
   */
  timeout: 900_000,
  // 确定性那组的报告为什么要走 reporter 而不是用例自己写，见 deterministicReporter.ts。
  reporter: [['list'], ['./src/node/deterministicReporter.ts']],
  // 图集不在就先打一份：它是构建产物、不进仓库，少了这一步第一次跑批只会看到一串 404。
  globalSetup: './src/node/ensureAtlas.ts',
  /*
   * 关键帧基线按平台分目录：字体光栅化在 macOS 和 Linux 上对不齐，一份基线两边一定比不过
   *（和目录页那条同一个决定，见 client 的 dev/storybook/playwright.config.ts）。
   * 目录名就是 `process.platform`：本机跑生成 darwin/，CI（Linux）用 linux/。
   * 只有 keyframes 那个 project 会用到它，别的 project 一张图都不拍。
   */
  snapshotDir: './baselines',
  snapshotPathTemplate: '{snapshotDir}/{platform}/{arg}{ext}',
  use: { baseURL: BASE_URL },
  webServer: {
    command: 'pnpm exec vite',
    url: BASE_URL,
    /*
     * 默认不复用已经在跑的服务器，显式设了 BENCH_REUSE_SERVER=1 才复用。
     *
     * 踩过的坑：端口是写死的（vite.config.ts 的 strictPort），另一个 git 工作树里
     * 开着同一个端口的 bench vite 时，这边会直接连上去——跑批量的是那份代码，
     * 于是这边改了什么都「看不出变化」，而且全程没有任何提示。
     * 宁可让它因为端口被占直接失败，那种失败一眼就知道怎么回事。
     */
    reuseExistingServer: process.env.BENCH_REUSE_SERVER === '1',
    timeout: 120_000,
  },
  projects: [
    {
      name: 'deterministic',
      testMatch: /deterministic\.spec\.ts/,
      /*
       * 拆到用例粒度并行。确定性指标只取决于剧本和渲染路径，和跑得快慢无关，
       * 所以用例之间没有耦合：每条各开各的页面、各开各的渲染进程，别的 worker 抢核
       * 只会让它变慢，不会改变它数出来的任何一个数。
       * 「连跑十段比堆基线」那条也一样——堆是它自己那个渲染进程里的。
       */
      fullyParallel: true,
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
      /*
       * 剧本关键帧的截图回归（6.6）。和确定性那组同一套无头 + SwiftShader 的跑法——
       * 软件渲染跨机器一致，基线才比得过。它抓完最后一帧就收工，所以比指标那组快得多。
       */
      name: 'keyframes',
      testMatch: /keyframes\.spec\.ts/,
      fullyParallel: true,
      timeout: 600_000,
      use: {
        browserName: 'chromium',
        headless: true,
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
    {
      /*
       * 交互回归（6.6 第 2 条）。和确定性那组同样是无头 + SwiftShader，但它不量任何东西，
       * 所以一条用例几十秒就完了，超时走下面那个覆盖而不是顶上那个 15 分钟。
       * 各条用例各开各的浏览器，之间没有耦合，照样并行。
       *
       * 3 分钟是按本机最慢那条（47 秒，几个 worker 抢核时）留三倍余量给的。
       * 两核跑机上一条实测只要 4～6 秒——那儿慢的从来不是这几下点击，
       * 而是每条都要重新起浏览器、重新加载页面和图集。
       * 这个数**不是**用来兜「上下文建不出来」那种卡死的：那种情况给多久都不会返回，
       * 治它的是 tests/freshBrowser.ts。
       */
      name: 'interaction',
      testMatch: /interaction\.spec\.ts/,
      fullyParallel: true,
      timeout: 180_000,
      use: {
        browserName: 'chromium',
        headless: true,
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
