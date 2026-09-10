/**
 * 存放「当前这一局」的 driver，让它跨得过路由切换。
 *
 * 对局都是在**别的页面**建好 driver 再跳到 `/match` 的：单机在首页建，联机在房间页建
 *（第 27b 条）。跳转会把建 driver 的那个页面整个卸载掉，所以 driver 不放在路由之上就没了。
 *
 * Provider 挂在 Router 外面，也**不写存储**：刷新页面 = 这一局没了。
 * 这和架构里「不存对局」是一致的——`/match` 读不到 driver 就跳回首页。
 */

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import type { MatchDriver } from '../match/driver'

/**
 * 这一局是哪种玩法。界面按它决定要不要挂测试面板、要不要记胜场。
 *
 * `'test'` 是 dev 测试房：那是随手摆出来的局面，不该刷胜场和抽卡。
 * 热座和联机都算真打，都记胜场。
 */
export type MatchMode = 'test' | 'hotseat' | 'online'

interface MatchSession {
  driver: MatchDriver | null
  mode: MatchMode
  /** 交接一个新 driver。已有的会先被 dispose——旧连接和旧定时器不能留着。 */
  start(driver: MatchDriver, mode: MatchMode): void
  /** 结束当前对局并释放资源（关 socket、清定时器）。 */
  end(): void
}

const MatchSessionContext = createContext<MatchSession | null>(null)

/** driver 和 mode 必须同进同出，所以放在一个 state 里，不拆成两个。 */
interface SessionState {
  driver: MatchDriver | null
  mode: MatchMode
}

const IDLE: SessionState = { driver: null, mode: 'test' }

export function MatchSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>(IDLE)

  /*
   * dispose 旧的那一下放在 setState 的回调里，不是在外面读一次 state 再拆。
   * React 18 起同一轮里可能连着调好几次 start（严格模式的双次执行就是），
   * 在外面读到的会是同一份旧值，于是第一个新 driver 谁也不拆、直接漏掉。
   */
  const start = useCallback((next: MatchDriver, mode: MatchMode) => {
    setSession((current) => {
      current.driver?.dispose()
      return { driver: next, mode }
    })
  }, [])

  const end = useCallback(() => {
    setSession((current) => {
      current.driver?.dispose()
      return IDLE
    })
  }, [])

  const value = useMemo<MatchSession>(
    () => ({ driver: session.driver, mode: session.mode, start, end }),
    [session, start, end],
  )
  return <MatchSessionContext value={value}>{children}</MatchSessionContext>
}

export function useMatchSession(): MatchSession {
  const session = useContext(MatchSessionContext)
  if (session === null) throw new Error('useMatchSession 必须在 MatchSessionProvider 里用')
  return session
}
