/**
 * 组件目录页的截图回归（《正式版架构》6.6、6.8：目录页每个条目截一张图做回归）。
 *
 * 比对用 Playwright 自带的 `toHaveScreenshot`——它内部就是 pixelmatch（6.12 那一行点名的那个），
 * 没必要自己写一遍比对和差异图。
 *
 * 只跑 Chromium：6.1 快档的口径就是一个浏览器，三浏览器一致性是慢档的事（第 34 条）。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 包根（packages/client）。Storybook 的命令和 -c 路径都相对它写。 */
const CLIENT_ROOT = resolve(HERE, '../..')

/**
 * 目录页服务的端口。
 *
 * 和 `pnpm storybook` 交互式那份（6006）错开：开着目录页看组件的同时还能跑比对，
 * 两边各起各的，谁也不占谁。
 */
const PORT = 6007
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: HERE,
  testMatch: /catalog\.spec\.ts/,
  /*
   * 只有一条用例（它自己在里面遍历所有条目，理由见 catalog.spec.ts），所以并行没有意义。
   * 用例里那一串条目是**串着**拍的：每个条目都要建一个 WebGL 上下文，
   * 而 Chromium 对同时存活的上下文数量有硬上限，抢起来会随机丢掉几个。
   */
  workers: 1,
  /*
   * 单条用例 5 分钟。它要把所有条目走一遍，每条都是「开页面 → 等画布就绪 → 截图比对」。
   * 本机（M 系列，软件渲染）实测约 30 秒，留出五倍余量给 CI 上更慢的机器。
   */
  timeout: 300_000,
  reporter: [['list']],
  // 图集不在就先打一份：少了它每条画布条目都是一句提示，基线全对不上。
  globalSetup: './ensureAtlas.ts',
  /*
   * 基线图按平台分目录。
   *
   * 必须分：字体光栅化在 macOS 和 Linux 上不一样，卡面铭牌和令牌页上的字每个像素都对不齐，
   * 一份基线两个平台一定比不过。目录名就是 `process.platform`，
   * 本机跑生成 darwin/，CI（Linux）用 linux/。怎么补 linux 基线见 README.md。
   */
  snapshotPathTemplate: '{testDir}/baselines/{platform}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      /*
       * 允许的差异比例。
       *
       * 从最小的一档 0.1% 起步：目录页是确定性的（手动时钟推到固定一帧、随机数定种子、
       * 渲染倍率钉死），同一台机器上连跑两次应该是逐像素相同，留这一档只是给
       * 抗锯齿边缘上零星几个像素的浮动兜底。拍的是条目自己那一块而不是整页
       * （见 catalog.spec.ts），所以分母就是条目的实际大小：最大的一条 1000×460 里
       * 0.1% 是 460 个像素，真有样式改动时改的像素远多于这个数。
       *
       * 顶不住了要先查是不是引入了不确定性（真实时钟、未定种子的随机、字体没加载完），
       * 而不是先把这个数调大——调大一次就等于把这道检查关掉一点。
       */
      maxDiffPixelRatio: 0.001,
      // 页面上的 CSS 动画一律停在第一帧。画布那边的确定性由手动时钟保证，和这条无关。
      animations: 'disabled',
    },
  },
  use: {
    baseURL: BASE_URL,
    /*
     * 视口和渲染倍率都钉死：基线是按这两个数拍的，跟着机器走就没法比。
     * deviceScaleFactor 取 1 而不是 2，是因为画布那边的渲染倍率跟着 devicePixelRatio 走
     * （见 pixiStory.tsx），钉在 1 才能保证基线永远是同一档分辨率。
     */
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
             * 走 ANGLE 的 SwiftShader 后端，和 bench 的确定性那组同一套理由：
             * 没有独显的跑机也能跑 WebGL，而且不同机器的 GPU 驱动差异不会渗进基线图里。
             * 剩下的跨平台差异只有字体光栅化那一项，由上面按平台分目录的基线兜住。
             */
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm exec storybook dev -c dev/storybook --no-open --quiet -p ${PORT}`,
    cwd: CLIENT_ROOT,
    url: `${BASE_URL}/index.json`,
    /*
     * 不复用已经在跑的服务器。端口是写死的，另一个工作树里开着同一个端口的目录页时，
     * 这边会直接连上去——拍的是那份代码，而且全程没有任何提示。
     * 宁可让它因为端口被占直接失败，那种失败一眼就知道怎么回事（和 bench 同一个决定）。
     */
    reuseExistingServer: false,
    // 冷启动要让 Vite 预构建 pixi、gsap、react 那几个大包，两分钟是本机实测的三倍余量。
    timeout: 180_000,
  },
})
