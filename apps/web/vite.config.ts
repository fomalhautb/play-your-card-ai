import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 本地开发时服务端（`wrangler dev`）在哪。用 `SERVER_URL` 换一个，端到端那份就是这么错开的。
 * 只影响开发服务器：线上前端和 Worker 是同一个 Worker、同一个域名，压根没有代理这回事。
 */
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8787'

/**
 * 转给 wrangler 的四条路径。
 *
 * 为什么要代理而不是让客户端直接连 8787：账号的会话在 cookie 里，而 cookie 和
 * better-auth 的来源检查都认「同源」。代理之后浏览器眼里只有 Vite 那一个源，
 * 本地开发因此和线上走的是同一条代码路径（见 packages/client/src/net/endpoints.ts）。
 *
 * `^/match/\d{4}$` 写成正则而不是前缀：`/match` **同时是前端的对局页路由**，
 * 按前缀匹配的话玩家一进对局页就会被转给 Worker，拿回一句「这个地址只接 WebSocket」。
 * 房间的 WebSocket 端点必然带四位房间码，正则把两者分得干干净净。
 * `/lobby` 和 `/api` 不是前端路由，前缀匹配就够。
 */
const PROXY = {
  '/api': { target: SERVER_URL, changeOrigin: true },
  '/lobby': { target: SERVER_URL, changeOrigin: true, ws: true },
  '^/match/\\d{4}$': { target: SERVER_URL, changeOrigin: true, ws: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    // 默认 5174 而不是 Vite 的 5173：那个端口常年被别的 worktree 或者别的项目占着。
    // 再撞就用 PORT 换一个。
    port: Number(process.env.PORT ?? 5174),
    // 局域网里另一台设备（手机、第二台电脑）要能用局域网 IP 打开，所以不能只监听 localhost。
    host: true,
    proxy: PROXY,
  },
})
