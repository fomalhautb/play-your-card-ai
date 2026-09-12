/**
 * 把游客账号接进 React：一个 Provider 加两个 hook。
 *
 * Provider 挂在 `PlatformProvider` 里面、路由外面（见 App.tsx）：账号是**整个应用一份**，
 * 房间页要拿它显示「游客 xxxx」，大厅和房间两条连接要拿它换 JWT。
 * 每页各建一份的话，换一次页面就多问一次服务端，重连时还可能拿到另一个号的 token。
 *
 * 状态走 `useSyncExternalStore`，和 driver 那边同一个理由（见 match/useMatch.ts）：
 * 账号是 React 之外的可变数据源，状态层因此一个库都不用引。
 */

import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from 'react'
import { usePlatform } from '../app/platform'
import { type AuthSession, type AuthState, createAuthSession } from './session'

const SessionContext = createContext<AuthSession | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform()
  /*
   * 用 useState 的惰性初始化而不是 useMemo：useMemo 是「可以随时重算」的缓存，
   * React 明说它有权丢掉结果重算一遍，而重算一遍等于再开一次会话请求。
   *
   * 开发构建下 StrictMode 仍然会把这个初始化跑两遍，也就是真的建出两份来。
   * 那种情况由 session.ts 自己兜住（开号被 400 挡回来时回头再问一次会话），
   * 这里不为它多加一层全局缓存——那会把「一份」这件事藏进一个看不见的地方。
   */
  const [session] = useState(() => createAuthSession({ platform }))
  return <SessionContext value={session}>{children}</SessionContext>
}

/**
 * 账号这一层本身。要 `token()` 的地方用它——那是给 driver 和大厅客户端的，
 * 不是给界面渲染的，所以拿的是句柄而不是状态。
 */
export function useAuthSession(): AuthSession {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useAuthSession 必须在 AuthProvider 里用')
  return session
}

/** 账号此刻的状态。界面拿它显示「游客 xxxx」、登录中、或者一句错和重试。 */
export function useSession(): AuthState {
  const session = useAuthSession()
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}
