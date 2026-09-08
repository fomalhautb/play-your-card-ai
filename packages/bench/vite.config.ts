/**
 * 测量页面的开发服务器。Playwright 的 webServer 会拉起它。
 *
 * 不做生产构建：bench 是测量工具，不进任何平台的构建产物（见 src/index.ts 的说明）。
 * 端口写死并且 strictPort，是为了 Playwright 的 baseURL 能写死；
 * 端口被占时希望它直接失败，而不是换一个端口让测试连到别的服务上去。
 */

import { defineConfig } from 'vite'

export const BENCH_PORT = 5199

export default defineConfig({
  // host 写死 127.0.0.1：默认的 localhost 在这台机器上解析到 IPv6 的 ::1，
  // Playwright 那边连 127.0.0.1 会被拒。两边用同一个字面量最省事。
  server: { host: '127.0.0.1', port: BENCH_PORT, strictPort: true },
  // 卡面图集以后放这里（同事的图集脚本会复制到 public/atlas/，那个目录进了 .gitignore）。
  publicDir: 'public',
  // 每次都重新求值依赖，省得改了 pixi 版本还在用旧的预构建产物。
  optimizeDeps: { include: ['pixi.js', 'gsap'] },
})
