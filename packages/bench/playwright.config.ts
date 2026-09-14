/**
 * 跑批器。几个 project 各管一件事，`pnpm bench` 默认只跑确定性那组。
 *
 * - deterministic：无头 Chromium，强制 SwiftShader 软件渲染。软件渲染慢，但它跨机器一致，
 *   而 6.9 的确定性指标要的正是「同一段剧本在任何机器上一模一样」。时间快慢在这一组里没有意义。
 * - keyframes：剧本关键帧的截图回归（6.6），同样是无头 + SwiftShader，抓完最后一帧就收工。
 * - keyframes-webkit / keyframes-firefox：三浏览器一致性（6.10），和 keyframes 拍同样的帧，
 *   拿 chromium 那张基线当参照物比。这两家**不按**软件渲染跑，理由见它们自己的说明。
 * - interaction：真指针的交互回归（6.6 第 2 条），不量任何东西。
 * - timing：有头、开 GPU、真实时钟，录 Chrome trace。它默认不跑（--project 显式指定），
 *   因为它慢、要 GPU、而且在无头软件渲染的 CI 快档上量出来的时间没有参考价值。
 *
 * 各组对并发的要求不一样，所以并行开在各自的 project 上而不是顶层，见下面各自的说明。
 */

import { availableParallelism } from 'node:os'
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
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

/**
 * 三浏览器一致性（6.10、迁移第 34 条）的两个 project，跑的都是 crossBrowser.spec.ts。
 * chromium 那一遍不在这里跑：它拍的图就是 `baselines/{平台}/` 里的关键帧基线，
 * 快档每个 PR 都重拍并逐像素比过，直接拿来当参照物（理由见那个 spec 的文件头）。
 *
 * **这两家一律不加软件渲染的开关**，和 chromium 那几个 project 正相反：
 * 这条检查要的就是「各家用自己平时那条路画出来的东西一样不一样」，
 * 硬把三家都按到同一个光栅器上，检查也就没什么可查的了。代价是本机（macOS）上
 * 它们走的是真 GPU 而 chromium 走 SwiftShader，差异比例因此偏大——那正是阈值要吃下的部分。
 *
 * 超时照搬关键帧那组的 10 分钟：跑的是同一段剧本、同样抓齐就收工。
 * 真 GPU 那两家实际上比 chromium 快得多，这个数是留给 Linux 跑机上的软件光栅的。
 */
const crossBrowserProjects: NonNullable<PlaywrightTestConfig['projects']> = [
  {
    name: 'keyframes-webkit',
    testMatch: /crossBrowser\.spec\.ts/,
    fullyParallel: true,
    timeout: 600_000,
    /*
     * WebKit 没有可传的启动参数（Playwright 那边 `args` 对它不生效），
     * 所以这里什么也调不了：它在 macOS 上走 Metal 后端的 ANGLE、在 Linux 上走自带的那套，
     * 有什么用什么。跑不起来的话只能在报告里记一笔，没有开关可拧。
     */
    use: { browserName: 'webkit', headless: true },
  },
  {
    name: 'keyframes-firefox',
    testMatch: /crossBrowser\.spec\.ts/,
    fullyParallel: true,
    timeout: 600_000,
    use: {
      browserName: 'firefox',
      /*
       * **Linux 上必须有头。** Firefox 的无头模式是**写死不给 WebGL** 的
       *（`WebGLContext.cpp` 里那句 "Can't use WebGL in headless mode"，上游
       * bugzilla 1375585 从 2017 年挂到现在还没修）：页面拿到的 `getContext('webgl2')`
       * 是 null，Pixi 当场抛 `No available renderer for the current environment`。
       * 慢档 firefox 那四格第一次跑就是这么全红的（运行 34674939419）。
       * 跑机上没有显示器，所以由工作流在外面套一层 xvfb 给它一块虚拟屏
       *（见 .github/workflows/slow.yml 的 cross-browser 那一格）。
       *
       * macOS 上仍然无头：那边无头照样有 WebGL（本机那张实测表就是无头量出来的），
       * 改成有头只会在开发者屏幕上真弹出一串窗口。
       */
      headless: process.platform !== 'linux',
      launchOptions: {
        /*
         * 两条都是给**没有显卡的 Linux 跑机**留的保险，macOS 上是空操作（开不开都一样）。
         * Firefox 有一张图形黑名单，认不出的驱动（跑机上的软件光栅就是这一类）会被它
         * 直接判成「不给 WebGL」，那时候页面拿到的是 null 上下文、场景一帧都画不出来。
         * force-enabled 是绕过黑名单的那个开关，disabled 只是再明确一次别关掉。
         * 这两条治的是「驱动被拉黑」，治不了上面那条无头限制——那一条在挑驱动之前就否了。
         */
        firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
      },
    },
  },
]

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
   * 单条用例的超时：本机 15 分钟，CI 上 35 分钟。
   *
   * 这个数是被 SwiftShader 顶上来的：桌面档 1920×1080 按 1.5 倍渲染就是 2880×1620，
   * 软件光栅在这个分辨率上是填充率绑定的（画多少像素就花多少时间），
   * 而每条用例要把同一段剧本跑三轮——逐帧记录一轮、关掉记录做堆采样一轮、
   * 再重跑一轮验两遍完全一致。
   *
   * **本机 15 分钟**：迁移第 18 条接上真对局场景之后从 8 分钟提上来的，原因是剧本变长了。
   * `play10` 现在打的是一局真对局，一张一张打、每张等演出收完再打下一张，
   * 十张连打覆盖约 26 秒的演出，一轮就是 1589 帧（原型那版只有四百来帧）。
   * 这台 M2 上最慢的一条（desktop/play10）单独跑 6.8 分钟。之所以不是 7 分钟：
   * 并行之后同一条用例会变慢，SwiftShader 是纯 CPU 的，几个 worker 一起跑就在抢同一批核
   *（M2 八个逻辑核里只有 4 个是性能核）。超时要按「并行时的最慢一条」给：
   * desktop/play10 跑整批时实测 12.9 分钟（慢 1.9 倍），按 8 分钟给会当场超时，取整到 15。
   *
   * **CI 上 35 分钟**：两核的 ubuntu 跑机比这台 M2 慢一大截，而慢档一格只跑一条用例、
   * 不存在抢核，所以本机那条「并行时的最慢一条」在那边不适用，得按跑机自己的实测给。
   * 2026-09-12 的运行 34674939419（一格一台跑机）：mobile/deal 1.9 分钟、
   * mobile/deckScroll 1.8、mobile/settle 2.8、mobile/flip 3.9、desktop/deckScroll 8.7、
   * desktop/flip 8.9、desktop/deal 13.9 分钟，而 desktop/play10、desktop/settle、
   * mobile/play10 三条都是跑到 15 分钟被这个超时掐掉的——**掐在第三轮上**，
   * 前两轮都跑完了，也就是说它们不是卡住而是纯粹跑不完（掐掉前的上限断言全过）。
   * 按第三轮和第一轮同样重推算，最慢的 desktop/play10 整条约 24 分钟，
   * 留约 1.5 倍余量取整到 35。顶破 35 分钟要查的是剧本为什么变长了，不是再往上抬。
   *
   * 要让它真的跑快只能少跑一轮、缩短剧本或者降分辨率，那三样都是改口径，另议。
   */
  timeout: process.env.CI ? 2_100_000 : 900_000,
  // 确定性那组的报告为什么要走 reporter 而不是用例自己写，见 deterministicReporter.ts。
  reporter: [['list'], ['./src/node/deterministicReporter.ts']],
  // 图集不在就先打一份：它是构建产物、不进仓库，少了这一步第一次跑批只会看到一串 404。
  globalSetup: './src/node/ensureAtlas.ts',
  /*
   * 关键帧基线按平台分目录：字体光栅化在 macOS 和 Linux 上对不齐，一份基线两边一定比不过
   *（和目录页那条同一个决定，见 client 的 dev/storybook/playwright.config.ts）。
   * 目录名就是 `process.platform`：本机跑生成 darwin/，CI（Linux）用 linux/。
   *
   * 模板里**故意不放 {projectName}**：三浏览器一致性那两个 project 要按同一个路径去读
   * chromium 那张图当参照物（见 tests/crossBrowser.spec.ts），加了就各读各的了。
   * 写这个目录的只有 keyframes 一个 project，别的 project 要么只读、要么一张图都不拍。
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
    ...crossBrowserProjects,
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
