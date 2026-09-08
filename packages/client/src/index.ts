/**
 * 装配层：路由、屏幕、状态、本地驱动（单机、教程）和服务端驱动（联机）。
 *
 * 这是唯一一个把所有东西串起来的包——`apps/` 下的三个壳只负责挂载它，不写业务。
 * 允许依赖：`core`、`content`、`protocol`、`design`、`platform`、`canvas`、`ui`，也就是全部。
 * 反过来 `packages/` 里的包一个都不许依赖它，只有 `apps/` 下的壳可以。
 *
 * 开发专用页面（组件目录页、调试场景）放在 `src/dev`，生产构建剔除。
 */

export { App } from './App'
export type {
  MatchDriver,
  MatchEventBatch,
  MatchLink,
  MatchStatus,
  MatchView,
  PeerState,
} from './match/driver'
export type { ServerDriver, ServerDriverOptions } from './match/serverDriver'
export { createServerDriver } from './match/serverDriver'
export { lobbyUrl, roomUrl } from './net/endpoints'
export type { LobbyClient, LobbyClientOptions } from './net/lobbyClient'
export { createLobbyClient, LobbyError } from './net/lobbyClient'
