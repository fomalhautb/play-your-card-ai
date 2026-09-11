import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Steam 壳的**渲染进程**构建。主进程和 preload 不走这里，它们由 tsc 直接编译成
 * CommonJS 落在 `dist/main/`（见 tsconfig.json 的说明）。
 *
 * 和网页壳那份（apps/web/vite.config.ts）几乎一样，三处不同：
 * 1. 产物落在 `dist/renderer/`，因为同一个 dist 下还住着主进程那半边；
 * 2. 静态资源目录**借用网页壳的**（见下面 `publicDir`）；
 * 3. 开发端口错开，两个壳可以同时开着比对。
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8787'

/**
 * 转给 wrangler 的三条路径，**只在开发时有用**。
 *
 * 打包之后页面由主进程挂到线上那个源上，这几条路径由它分流（见 src/site.ts 和 src/config.ts），
 * 和这里是同一份名单的两种写法，改一处要一起看。
 * `^/match/\d{4}$` 写成正则而不是前缀：`/match` 同时是前端的对局页路由。
 */
const PROXY = {
  '/api': { target: SERVER_URL, changeOrigin: true },
  '/lobby': { target: SERVER_URL, changeOrigin: true, ws: true },
  '^/match/\\d{4}$': { target: SERVER_URL, changeOrigin: true, ws: true },
}

export default defineConfig({
  plugins: [react()],
  /*
   * 卡面图集、界面底图、音频都在网页壳的 public 下面（`pnpm assets:build` 分发到那儿的，
   * 见 assets/build-atlas.mjs）。直接借用而不是再分发一份：同一堆几兆的东西没道理在仓库里
   * 存两遍，而 Vite 的 publicDir 本来就允许指到 root 外面。
   */
  publicDir: fileURLToPath(new URL('../web/public', import.meta.url)),
  build: {
    /*
     * 落在 `dist/renderer` 而不是 `dist`：构建前 Vite 会把 outDir 清空，
     * 而 `dist/main` 里住着 tsc 编译出来的主进程代码——两边共用一个目录的话，
     * 先跑哪个就会把另一个的产物删掉（`pnpm build` 里它们是一前一后跑的）。
     */
    outDir: 'dist/renderer',
  },
  server: {
    // 和网页壳（5174）、端到端（5178）都错开。
    port: Number(process.env.PORT ?? 5175),
    proxy: PROXY,
  },
})
