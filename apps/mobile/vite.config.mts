import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 手机壳的网页构建。产物落在 `dist/`，由 Capacitor 原样复制进原生工程
 *（`capacitor.config.ts` 的 `webDir`）。
 *
 * 和网页壳那份（apps/web/vite.config.ts）几乎一样，三处不同：
 * 1. 静态资源目录**借用网页壳的**（见下面 `publicDir`）；
 * 2. 开发端口错开，几个壳可以同时开着比对；
 * 3. `base: './'` ——原生壳里页面不一定挂在根路径上，相对路径两种情况都对。
 *
 * 为什么不干脆让 Capacitor 直接用 `apps/web/dist`：那样手机上跑的入口就是网页壳的入口，
 * 平台实现是 `createWebPlatform()`，第 36 条补的那套 capacitor 实现一行都用不上。
 * 两个壳差的正是入口那一行（和 Steam 壳一样），所以各自构建各自的。
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8787'

/**
 * 转给 wrangler 的三条路径，**只在开发时有用**。
 *
 * 名单和网页壳那份一模一样（apps/web/vite.config.ts），改一处要一起看。
 * `^/match/\d{4}$` 写成正则而不是前缀：`/match` 同时是前端的对局页路由。
 *
 * 打包之后没有代理这回事：页面的源是本机那个，服务端地址由平台层改指线上
 *（见 packages/platform/src/capacitor/origin.ts）。
 */
const PROXY = {
  '/api': { target: SERVER_URL, changeOrigin: true },
  '/lobby': { target: SERVER_URL, changeOrigin: true, ws: true },
  '^/match/\\d{4}$': { target: SERVER_URL, changeOrigin: true, ws: true },
}

export default defineConfig({
  plugins: [react()],
  /*
   * 原生壳里页面是被 WebView 从本地产物加载的，`server.appStartPath` 之类的配置会让它
   * 不一定落在根路径上。相对路径两种情况都对，绝对路径只有根路径那种情况对。
   */
  base: './',
  /*
   * 卡面图集、界面底图、音频都在网页壳的 public 下面（`pnpm assets:build` 分发到那儿的，
   * 见 assets/build-atlas.mjs）。直接借用而不是再分发一份：同一堆几兆的东西没道理在仓库里
   * 存两遍，而 Vite 的 publicDir 本来就允许指到 root 外面。和 Steam 壳同一条理由。
   */
  publicDir: fileURLToPath(new URL('../web/public', import.meta.url)),
  server: {
    // 和网页壳（5174）、Steam 壳（5175）、端到端（5178）、性能剧本（5199）都错开。
    port: Number(process.env.PORT ?? 5176),
    /*
     * 必须监听局域网：真机调试时手机上的 WebView 要连这台电脑上的开发服务器
     *（`capacitor.config.ts` 的 `server.url`），只监听 localhost 的话手机连不上。
     */
    host: true,
    proxy: PROXY,
  },
})
