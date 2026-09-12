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
 * 现在有首页、选英雄页、开包、牌组页、房间页、对局、三个文字页（设置 / 账号 / 关于）
 * 和开发页。首页那颗「开始游戏」直接进联机房（见 screens/HomeScreen.tsx）。
 *
 * ## 应用壳开机时要做的两件事
 *
 * 装回静音状态、装回「减少动效」。两件都是**上一次的选择**（存在本机上），
 * 不装回去的话玩家每次进站都要重新关一遍声音。
 *
 * 这里原先还挂着两层常驻浮层（竖屏提示、全屏入口），在正式版简化第 2 步删掉了。
 * `platform` 的 safeArea / fullscreen 两样能力都留着：设置页那两条开关还在用。
 */

import type { Platform } from '@ai-duel/platform'
import { type ComponentType, lazy, Suspense, useEffect } from 'react'
import { Route, Switch } from 'wouter'
import { MatchSessionProvider } from './app/MatchSession'
import { PlatformProvider } from './app/platform'
import { applyReducedMotion } from './app/reducedMotion'
import { restoreMuted } from './audio/mute'
import { AuthProvider } from './auth/useSession'
import { loadSave } from './save/saveStore'
import { AccountScreen } from './screens/AccountScreen'
import { DeckScreen } from './screens/DeckScreen'
import { HeroScreen } from './screens/HeroScreen'
import { HomeScreen } from './screens/HomeScreen'
import { InfoScreen } from './screens/InfoScreen'
import { MatchScreen } from './screens/MatchScreen'
import { PackScreen } from './screens/PackScreen'
import { RoomScreen } from './screens/RoomScreen'
import { SettingsScreen } from './screens/SettingsScreen'
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
  /*
   * 把上一次存下来的两项选择装回去。放在 effect 里而不是模块顶层：
   * 它们都要碰浏览器（存储、document），而这个组件在测试里也会被渲染。
   * 依赖只有 platform——这两项一次会话只该装一遍，之后由设置页自己改。
   */
  useEffect(() => {
    restoreMuted(platform)
    applyReducedMotion(loadSave(platform).reducedMotion)
  }, [platform])

  return (
    <PlatformProvider platform={platform}>
      <AuthProvider>
        <MatchSessionProvider>
          <Switch>
            <Route path="/" component={HomeScreen} />
            <Route path="/hero" component={HeroScreen} />
            <Route path="/pack" component={PackScreen} />
            <Route path="/deck" component={DeckScreen} />
            <Route path="/room" component={RoomScreen} />
            <Route path="/match" component={MatchScreen} />
            <Route path="/settings" component={SettingsScreen} />
            <Route path="/account" component={AccountScreen} />
            <Route path="/info" component={InfoScreen} />
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
