import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // 默认 5174，特意错开 legacy-client 的 5173，两个客户端可以同时开着比对。
    // 端口再撞就用 PORT 换一个。
    port: Number(process.env.PORT ?? 5174),
    // 局域网里另一台设备（手机、第二台电脑）要能用局域网 IP 打开，所以不能只监听 localhost。
    host: true,
  },
})
