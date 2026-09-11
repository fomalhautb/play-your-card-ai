/**
 * 手机壳的入口。和网页壳那份（apps/web/src/main.tsx）只差一行：
 * 平台实现换成 `createCapacitorPlatform()`。
 *
 * 壳里不写业务：建平台实现、找到挂载点、把 `@ai-duel/client` 的根组件挂上去，就这三件事。
 * 藏系统栏和锁横屏都不在这儿——前者是 `capacitor.config.ts` 里一条声明，
 * 后者写死在原生工程里（见 README 的「横屏是怎么锁的」）。
 *
 * `createCapacitorPlatform` 从 `@ai-duel/client` 转出来，不直接 import `@ai-duel/platform`：
 * 依赖规则里 apps/ 下的壳只挂 client（见 .dependency-cruiser.cjs 的「依赖方向-apps-只挂-client」）。
 * 它以网页实现为底，只换掉网络、全屏、触感三项；不在原生壳里跑时（浏览器里打开同一份产物）
 * 它会自己退回纯网页实现，所以这份入口在 `pnpm --filter @ai-duel/mobile dev` 下也跑得起来。
 */
import { App, createCapacitorPlatform } from '@ai-duel/client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) throw new Error('index.html 里找不到 #root')

const platform = createCapacitorPlatform()

createRoot(root).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
)
