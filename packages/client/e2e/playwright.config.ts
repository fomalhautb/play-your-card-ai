/**
 * 端到端用例的跑批器配置（《正式版架构》6.11 的「单机模式一条」和「联机开两个页面」两条）。
 *
 * 和组件目录页那份（dev/storybook/playwright.config.ts）是两套：那边起的是 Storybook、
 * 拍的是截图；这边起的是真的 `apps/web` 开发服务器，走的是玩家真会走的那条路
 *（首页 → 对局 → 打完 → 结算页）。两份的端口、testDir 和超时都不一样，
 * 合成一份只会让「跑哪一套」变成一堆条件判断。
 *
 * 起**两个**服务：`wrangler dev`（权威服务端）和 Vite（前端）。联机那两条要真的连服务端，
 * 而单机那条用不上它——多起一个进程换来「一条命令跑全部」，比按用例分两份配置划算。
 * 前端到服务端不是直连：Vite 的 `server.proxy` 把 `/api`、`/lobby`、`/match/xxxx`
 * 转过去，浏览器眼里因此是同源（账号的会话在 cookie 里，见 apps/web/vite.config.ts）。
 *
 * CI 的快档暂时不接这一条（慢档是第 37 条的事），但它必须能在本机一条命令跑起来：
 * `pnpm --filter @ai-duel/client e2e`。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { LAUNCH_ARGS, VIEWPORT } from './players'

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

/**
 * 服务端的端口。和 `pnpm dev:server` 那份（8787）错开，理由同上面那条：
 * 手边开着开发服务器的同时还能跑端到端。
 *
 * 注意两边共用同一个本地 D1 和同一批 Durable Object 存储（都在
 * packages/server/.wrangler 下面），换端口只是换一个监听口，不是换一份数据。
 */
const SERVER_PORT = 8788
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`

export default defineConfig({
  testDir: HERE,
  testMatch: /.*\.spec\.ts/,
  /*
   * 一条用例要打完一整局。
   *
   * 单机那条本机实测 1 分多钟，大头是两段等待：找一张现在打得出去的手牌
   *（每试一张要等满 2.5 秒的演出锁兜底），以及 8 轮里每轮 2.5 秒的自动交卷。
   * 联机那两条更慢：两端各走各的，每一步还要多一个来回（本端 → 房间对象 → 两端各一份事件），
   * 掉线那条另外要停十秒。跑机慢一档就会翻倍，所以留到 10 分钟。
   */
  timeout: 600_000,
  // 用例之间共用同一个开发服务器，但各自会重开一局，并行没有意义也容易互相干扰。
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    /*
     * 视口和启动参数都从 e2e/players.ts 取，那边是联机用例自己开浏览器时用的同一份。
     * 两处必须一样：房间页和对局页那些按坐标点的地方都是按这个视口算出来的。
     */
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        headless: true,
        launchOptions: { args: LAUNCH_ARGS },
      },
    },
  ],
  // 图集、服务端密钥、账号库的表，三样都得先就位（见 globalSetup.ts）。
  globalSetup: './globalSetup.ts',
  webServer: [
    {
      /*
       * `--assets` 指到 apps/web/public 是给端到端用的临时替身：wrangler.jsonc 里那条
       * `assets.directory` 指着 `packages/legacy-client/dist`（线上那一版的构建产物，
       * 第 38 条之前不动它），而刚 clone 完的仓库里没有它，wrangler 会直接拒绝启动。
       * 这几条用例一个静态资源都不请求——页面由 Vite 发，服务端只管 /api 和两条 WebSocket。
       */
      command: `pnpm --filter @ai-duel/server exec wrangler dev --port ${SERVER_PORT} --assets ../../apps/web/public`,
      cwd: REPO_ROOT,
      // 没登录时这条回 200 加一个 `null`，正好当「服务端起来了」的判据。
      url: `${SERVER_URL}/api/auth/get-session`,
      reuseExistingServer: false,
      // workerd 冷启动加上打包整个 Worker，一分钟是本机实测的四倍余量。
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @ai-duel/web dev --port ${PORT}`,
      cwd: REPO_ROOT,
      url: BASE_URL,
      // 代理转给上面那个 wrangler（见 apps/web/vite.config.ts）。
      env: { SERVER_URL },
      /*
       * 不复用已经在跑的服务器。端口是写死的，另一个工作树里开着同一个端口的话
       * 这边会直接连上去——跑的是那份代码，而且全程没有任何提示。
       * 宁可让它因为端口被占直接失败（和目录页那份同一个决定）。
       */
      reuseExistingServer: false,
      // 冷启动要让 Vite 预构建 pixi、gsap、react 那几个大包，两分钟是本机实测的三倍余量。
      timeout: 180_000,
    },
  ],
})
