/**
 * 网页壳的入口。壳只做三件事：建平台实现、找到挂载点、把 `@ai-duel/client` 的根组件挂上去。
 * 业务一行都不写——steam 和 mobile 两个壳将来也是同样的写法，只是换一份平台实现。
 *
 * 平台在**这里**建而不是在装配层里：哪一套实现能用是壳才知道的事（见 platform 包的文件头）。
 * 建一份往下传（`App` 再放进 Context），因为音频的静音开关、图片缓存、存储都是有状态的，
 * 建两份会出现「这半边界面静音了、那半边还在响」。
 *
 * `createWebPlatform` 从 `@ai-duel/client` 转出来，不直接 import `@ai-duel/platform`：
 * 依赖规则里 apps/ 下的壳只挂 client（见 .dependency-cruiser.cjs 的「依赖方向-apps-只挂-client」）。
 */
import { App, createWebPlatform } from '@ai-duel/client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) throw new Error('index.html 里找不到 #root')

const platform = createWebPlatform()

createRoot(root).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
)
