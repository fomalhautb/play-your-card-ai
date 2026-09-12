/**
 * Worker 的总路由。新旧两套服务端并排跑在同一个脚本里。
 *
 * - 旧的（`/api/room`、`/room/:code`）是黑客松那版纯转发器，线上的 legacy-client 还在用它，
 *   **一行行为都不能变**，实现在 src/legacy/（迁移第 38 条随 legacy-client 一起删）。
 * - 新的（`/match/:code` 和 `/lobby`）是权威房间对象和大厅对象，规则在服务端跑，
 *   实现在 src/room/ 和 src/lobby/。
 * - `/api/auth/*` 是账号系统（better-auth + D1，实现在 src/auth/），
 *   游客登录、换握手用的 JWT 都走它。
 *
 * 两套各有各的 Durable Object 绑定（`ROOM` / `MATCH_ROOM`、`LOBBY`）和各自的类，互不相干。
 * 类名和绑定名都不能改：Durable Object 是按类名找实例的。
 *
 * 静态资源也归这个 Worker 发（见 wrangler.jsonc 的 assets），所以只有一个域名。
 * 注意 `run_worker_first` 那条坑：`not_found_handling` 是 SPA 时，没在它里面列出来的路径
 * 会被资源层直接吃掉，Worker 永远轮不上，所以两套的路径前缀都要写进去。
 */

import { handleAuthRequest } from './auth/routes'
import { handleLegacyRequest } from './legacy/routes'
import { LOBBY_NAME } from './lobby/naming'

export { Room } from './legacy/room'
export { Lobby } from './lobby/Lobby'
export { MatchRoom } from './room/MatchRoom'

/** 新房间的 WebSocket 端点。房间码就是房间对象的名字，形状和旧的一样是四位数字。 */
const MATCH_PATH = /^\/match\/(\d{4})\/?$/

/** 大厅的 WebSocket 端点。路径里不带名字：全局只有一个大厅（见 lobby/naming.ts）。 */
const LOBBY_PATH = '/lobby'

export default {
  async fetch(request, env) {
    const legacy = await handleLegacyRequest(request, env)
    if (legacy !== null) return legacy

    // 账号系统（游客登录、换 JWT、公钥集）。放在旧转发器后面纯粹是为了让它那一段保持原样——
    // 两边的路径没有交集（旧的只认 /api/room 和 /room/:code），谁先谁后结果一样。
    const auth = await handleAuthRequest(request, env)
    if (auth !== null) return auth

    // 这两个地址只接 WebSocket，不像旧的 /room/:code 还兼着前端路由，
    // 所以非升级请求直接回 426 而不是回 index.html。
    const { pathname } = new URL(request.url)
    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'

    const match = MATCH_PATH.exec(pathname)
    if (match) {
      if (!isUpgrade) return new Response('这个地址只接 WebSocket 升级请求', { status: 426 })
      return env.MATCH_ROOM.getByName(match[1]!).fetch(request)
    }

    if (pathname === LOBBY_PATH) {
      if (!isUpgrade) return new Response('这个地址只接 WebSocket 升级请求', { status: 426 })
      return env.LOBBY.getByName(LOBBY_NAME).fetch(request)
    }

    // 剩下的都是页面请求，交给静态资源层，匹配不到的路径回 index.html。
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
