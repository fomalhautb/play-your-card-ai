/**
 * 正式版的根组件占位。
 *
 * 现在只做两件事：渲染一行字，以及在开发构建里按路径挂开发专用页面。
 * 真正的路由表、屏幕和状态从迁移第 21 条起往里填；在那之前不引路由库，
 * 一个 `location.pathname` 的比较够用了。
 */

import { type ComponentType, lazy, Suspense } from 'react'

/**
 * 开发专用页面（架构 7.2 第 5 条：放在 client/dev，生产构建剔除）。
 *
 * 剔除靠两样东西配合：`import.meta.env.DEV` 会被打包器在生产构建里替换成字面量 false，
 * 于是整个三元表达式变成 `false ? … : {}`，连同里面那个动态 import 一起被当成死代码删掉。
 * 所以这里必须是**动态** import——写成文件顶部的静态 import 的话，
 * 无论条件真假模块都会被打进包里。
 */
const DEV_PAGES: Record<string, ComponentType> = import.meta.env.DEV
  ? {
      '/dev/duel': lazy(async () => ({
        default: (await import('./dev/DuelDev')).DuelDev,
      })),
    }
  : {}

export function App() {
  const DevPage = DEV_PAGES[window.location.pathname]
  if (DevPage !== undefined) {
    // 开发页是懒加载的，第一帧还没到手；这一行字只在本地闪一下，不进生产包。
    return (
      <Suspense fallback={<div>正在加载开发页…</div>}>
        <DevPage />
      </Suspense>
    )
  }
  return <div>正式版施工中</div>
}
