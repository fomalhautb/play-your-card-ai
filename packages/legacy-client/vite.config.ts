import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 这一版冻结在自己那份 core 快照上（src/core-snapshot，见 README）：
      // 正式版的 core 已经把卡牌数据搬去 content、改了 createGame 的签名，
      // 而这一版还在线上跑，不跟着动。源码里的 `@ai-duel/core` 一行都不用改。
      // tsconfig.json 的 paths 里有一条一模一样的，改一处要改两处
      //（那条管类型检查，这条管打包和 vitest）。
      '@ai-duel/core': fileURLToPath(new URL('./src/core-snapshot/index.ts', import.meta.url)),
    },
  },
  server: {
    // 默认 5173；同时开着多个工作树时端口会撞，用 PORT 换一个即可。
    port: Number(process.env.PORT ?? 5173),
    // 黑客松是两台电脑联机，另一台要用局域网 IP 打开这个页面，所以不能只监听 localhost。
    host: true,
  },
})
