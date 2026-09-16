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
 * 常驻浮层现在只有一层：右上角那颗静音钮（见 app/MuteButton.tsx）。
 * 原先那两层（竖屏提示、全屏入口）在正式版简化第 2 步删掉了。
 * `platform` 的 safeArea / fullscreen 两样能力都留着：设置页那两条开关还在用。
 * 原先这里还 import 过 `@ai-duel/design/tokens.css`，第 5 步连同那份 CSS 产物一起删了：
 * 样式剥成素方块之后没有一条 `var(--…)` 还在读它。
 */

import type { Platform } from '@ai-duel/platform'
import { type ComponentType, lazy, Suspense, useEffect } from 'react'
import { Route, Switch, useLocation } from 'wouter'
import { MatchSessionProvider } from './app/MatchSession'
import { MuteButton } from './app/MuteButton'
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

/**
 * 右上角那颗静音钮唯一不渲染的一页。
 *
 * 对局顶栏右端就是「离开」，DOM 钮正好压在它上面，点「离开」会点到静音上。
 * 这一页的静音改成顶栏里的一格（见 canvas 的 components/TopBar.ts）。
 * 别的画布页都验过右上角没有可点的东西，照常渲染。
 */
const NO_MUTE_BUTTON = '/match'

export function App({ platform }: { platform: Platform }) {
  /*
   * 把上一次存下来的两项选择装回去。放在 effect 里而不是模块顶层：
   * 它们都要碰浏览器（存储、document），而这个组件在测试里也会被渲染。
   * 依赖只有 platform——这两项一次会话只该装一遍，之后由设置页自己改。
   *
   * 静音那一项多带一个兜底值：**本地开发默认静音**是用户提的要求（开着开发服务器
   * 反复刷新时不想每次都被音乐吵到）。`import.meta.env.DEV` 只在这里读，
   * 生产构建（网页、Electron、Capacitor 三个壳出的包都是）里它是字面量 false，
   * 玩家那边仍然默认有声。存过的以存档为准，见 audio/mute.ts。
   */
  const [location] = useLocation()

  useEffect(() => {
    restoreMuted(platform, import.meta.env.DEV)
    applyReducedMotion(loadSave(platform).reducedMotion)
  }, [platform])

  return (
    <PlatformProvider platform={platform}>
      <AuthProvider>
        <MatchSessionProvider>
          {/* 摆在 Switch 外面：它跟着路由走，但不属于任何一页。 */}
          {location === NO_MUTE_BUTTON ? null : <MuteButton />}
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
