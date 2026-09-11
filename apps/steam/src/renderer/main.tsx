/**
 * Steam 壳的渲染进程入口。和网页壳那份（apps/web/src/main.tsx）只差一行：
 * 平台实现换成 `createElectronPlatform()`。
 *
 * 壳里不写业务：建平台实现、找到挂载点、把 `@ai-duel/client` 的根组件挂上去，就这三件事。
 *
 * `createElectronPlatform` 从 `@ai-duel/client` 转出来，不直接 import `@ai-duel/platform`：
 * 依赖规则里 apps/ 下的壳只挂 client（见 .dependency-cruiser.cjs 的「依赖方向-apps-只挂-client」）。
 * 它以网页实现为底，只换掉全屏、触感，再补上 Steam 那一项；preload 那座桥不在时
 * 它会自己退回纯网页实现，所以这份入口在浏览器里直接打开也跑得起来。
 */
import { App, createElectronPlatform } from '@ai-duel/client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) throw new Error('index.html 里找不到 #root')

const platform = createElectronPlatform()

createRoot(root).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
)
