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
   * 单条用例 15 分钟。它要把所有条目走一遍，每条都是「开页面 → 等画布就绪 → 截图比对」。
   * 一百条本机（M 系列，软件渲染）实测约 3 分钟；CI 那台两核跑机上重新生成一遍基线要 5 分多钟
   * （每条都得连拍两张，见下面 expect.timeout），留出的余量按最慢那一档的三倍算。
   */
  timeout: 900_000,
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
    /*
     * 单张截图的时限。
     *
     * 默认的 5 秒在 CI 上不够用，而且卡的不是"画面还在动"，是**软件渲染慢**：
     * 拍一张要浏览器合成好几帧（等元素稳定、rafraf、真正抓图），而这几帧在
     * SwiftShader 下是一格一格软件光栅出来的，画布越大越慢。最大的结算层是 1200×675，
     * 本机拍一张就要 2 秒出头，CI 那台两核跑机上还要再慢几倍。
     *
     * 生成基线时更吃时间：基线不存在时 Playwright 要**连拍两张一模一样的**才认账
     * （拍一张、隔一会儿再拍一张、比过了才写文件），一条条目就是两次上面那个开销。
     * 5 秒下最重的那几条（结算层各段、抛硬币停住那两条）连第一张都拍不完就超时了。
     *
     * 45 秒是按"CI 上一张十几秒、连拍两张二十多秒"再留一倍余量定的——跑机快慢波动很大，
     * 同一个 commit 的两次运行里超时的条目一次 7 条、一次 5 条。
     *
     * 放在 expect 上而不是下面的 toHaveScreenshot 块里：那个**配置**块只收
     * maxDiffPixelRatio 这类比对参数，收不了时限，所以统一那档只能写在 expect.timeout 上。
     * 这里调大的只是"愿意等多久"，比对的严格程度一点没动（阈值见下面）。
     *
     * 个别条目还是不够用（首页那三条，理由见 HomeScene.stories.ts）：那种在 story 自己的
     * `screenshotTimeoutMs` 里单独声明，catalog.spec.ts 会按条目传给 toHaveScreenshot
     * ——**逐次断言**是收 timeout 的，收不了的只有上面说的那个配置块。
     * 不为它们把这个数整体调大：调大是全局的，一条真坏掉的条目也要拖满新时限才报错。
     */
    timeout: 45_000,
    toHaveScreenshot: {
      /*
       * 允许的差异比例。
       *
       * 从最小的一档 0.1% 起步：目录页是确定性的（手动时钟推到固定一帧、随机数定种子、
       * 渲染倍率钉死），同一台机器上连跑两次应该是逐像素相同，留这一档只是给
       * 抗锯齿边缘上零星几个像素的浮动兜底。拍的是条目自己那一块而不是整页
       * （见 catalog.spec.ts），所以分母就是条目的实际大小：最大的一条 1200×675 里
       * 0.1% 是 810 个像素，真有样式改动时改的像素远多于这个数。
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
