/**
 * 正式版的根组件：平台能力、当前对局、路由表。
 *
 * 四层的顺序是定死的：`PlatformProvider` 在最外（谁都可能要音频和存储）→
 * `AuthProvider`（要平台的网络能力，进站就开游客号，见 auth/useSession.tsx）→
 * `MatchSessionProvider`（**必须在 Router 外面**，否则跳到 `/match` 时 driver 会被卸载掉，
 * 见 app/MatchSession.tsx）→ `Switch`。
 *
 * 路由用 wouter：一个几 KB 的库，只提供 `Route` / `Switch` / `useLocation`，
 * 没有 loader、没有嵌套路由那一套——这个应用的页面之间没有数据依赖关系，
 * 「匹配 → 选卡组 → 选英雄」那种流程是在**同一条路由内换 phase**（旧版就是这么做的）。
 *
 * 现在有首页、房间页、对局和开发页。牌组页、选英雄页、教程、设置和关于分别是
 * 第 28~32 条的事，到时候各自往下面这张表里加一行——
 * 首页菜单上那几颗钮已经指着它们的路由了，现在点进去会落到兜底那一条（「没有这一页」）。
 */

import type { Platform } from '@ai-duel/platform'
import { type ComponentType, lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import { MatchSessionProvider } from './app/MatchSession'
import { PlatformProvider } from './app/platform'
import { AuthProvider } from './auth/useSession'
import { HomeScreen } from './screens/HomeScreen'
import { MatchScreen } from './screens/MatchScreen'
import { RoomScreen } from './screens/RoomScreen'
// 设计令牌的 CSS 变量，全应用只在这里 import 一次挂到 :root 上——
// 每个组件各引一遍的话同一份变量会被打进包里好几次（见 ui 包的 index.ts）。
import '@ai-duel/design/tokens.css'
import './app/app.css'

/**
 * 开发专用页面（架构 7.2 第 5 条：放在 client/dev，生产构建剔除）。
 *
 * 剔除靠两样东西配合：`import.meta.env.DEV` 会被打包器在生产构建里替换成字面量 false，
 * 于是整个三元表达式变成 `false ? … : {}`，连同里面那两个动态 import 一起被当成死代码删掉。
 * 所以这里必须是**动态** import——写成文件顶部的静态 import 的话，
 * 无论条件真假模块都会被打进包里。
 */
const DEV_PAGES: Record<string, ComponentType> = import.meta.env.DEV
  ? {
      '/dev': lazy(async () => ({ default: (await import('./dev/DevIndex')).DevIndex })),
      '/dev/duel': lazy(async () => ({ default: (await import('./dev/DuelDev')).DuelDev })),
    }
  : {}

const DEV_ROUTES = Object.entries(DEV_PAGES)

export function App({ platform }: { platform: Platform }) {
  return (
    <PlatformProvider platform={platform}>
      <AuthProvider>
        <MatchSessionProvider>
          <Switch>
            <Route path="/" component={HomeScreen} />
            <Route path="/room" component={RoomScreen} />
            <Route path="/match" component={MatchScreen} />
            {DEV_ROUTES.map(([path, Page]) => (
              <Route key={path} path={path}>
                {/* 开发页是懒加载的，第一帧还没到手；这一行字只在本地闪一下，不进生产包。 */}
                <Suspense fallback={<p className="app-notice">正在加载开发页…</p>}>
                  <Page />
                </Suspense>
              </Route>
            ))}
            {/* 兜底那条不写 path，wouter 的 Switch 只在前面全都没匹配上时才走到它。 */}
            <Route>
              <p className="app-notice">没有这一页</p>
            </Route>
          </Switch>
        </MatchSessionProvider>
      </AuthProvider>
    </PlatformProvider>
  )
}
