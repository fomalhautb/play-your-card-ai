/**
 * 网页壳的入口。壳只做两件事：找到挂载点、把 `@ai-duel/client` 的根组件挂上去。
 * 业务一行都不写——steam 和 mobile 两个壳将来也是同样的写法。
 */
import { App } from '@ai-duel/client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) throw new Error('index.html 里找不到 #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
