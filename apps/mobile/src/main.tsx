/**
 * 手机壳的入口。和网页壳那份（apps/web/src/main.tsx）差的只有平台实现那一处：
 * 换成 `createCapacitorPlatform()`。
 *
 * 壳里不写业务：建平台实现、找到挂载点、把 `@ai-duel/client` 的根组件挂上去，就这三件事。
 * 藏系统栏和锁横屏都不在这儿——前者是 `capacitor.config.ts` 里一条声明，
 * 后者写死在原生工程里（见 README 的「横屏是怎么锁的」）。
 *
 * 平台实现从 `@ai-duel/client` 取，不直接 import `@ai-duel/platform`：依赖规则里 apps/ 下的壳
 * 只挂 client（见 .dependency-cruiser.cjs 的「依赖方向-apps-只挂-client」）。
 * 它以网页实现为底，只换掉网络、全屏、触感三项；不在原生壳里跑时（浏览器里打开同一份产物）
 * 它会自己退回纯网页实现，所以这份入口在 `pnpm --filter @ai-duel/mobile dev` 下也跑得起来。
 *
 * **为什么是两行 import**：`createCapacitorPlatform` 来自 client 的第二个入口 `/capacitor`，
 * 不是主入口。主入口是网页壳和 Steam 壳也要 import 的那一个，而这套实现底下挂着有副作用的
 * `@capacitor/core`（摇不掉），搁在主入口上会让那两个壳白背一份用不到的运行时
 *（见 packages/client/src/capacitor.ts 的文件头）。
 */
import { App } from '@ai-duel/client'
import { createCapacitorPlatform } from '@ai-duel/client/capacitor'
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
