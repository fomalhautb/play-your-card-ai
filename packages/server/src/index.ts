/**
 * Worker 的总路由。
 *
 * - `/match/:code` 是权威房间对象、`/lobby` 是做匹配的大厅对象，规则在服务端跑，
 *   实现在 src/room/ 和 src/lobby/。
 * - `/api/auth/*` 是账号系统（better-auth + D1，实现在 src/auth/），
 *   游客登录、换握手用的 JWT 都走它。
 *
 * 类名和绑定名都不能改：Durable Object 是按类名找实例的，改名等于把正在打的房间全丢了。
 *
 * 静态资源也归这个 Worker 发（见 wrangler.jsonc 的 assets），所以只有一个域名。
 * 注意 `run_worker_first` 那条坑：`not_found_handling` 是 SPA 时，没在它里面列出来的路径
 * 会被资源层直接吃掉，Worker 永远轮不上，所以要 Worker 处理的路径前缀都要写进去。
 */

import { handleAuthRequest } from './auth/routes'
import { LOBBY_NAME } from './lobby/naming'

export { Lobby } from './lobby/Lobby'
export { MatchRoom } from './room/MatchRoom'

/** 新房间的 WebSocket 端点。房间码就是房间对象的名字，形状和旧的一样是四位数字。 */
const MATCH_PATH = /^\/match\/(\d{4})\/?$/

/** 大厅的 WebSocket 端点。路径里不带名字：全局只有一个大厅（见 lobby/naming.ts）。 */
const LOBBY_PATH = '/lobby'

export default {
  async fetch(request, env) {
    // 账号系统（游客登录、换 JWT、公钥集）。
    const auth = await handleAuthRequest(request, env)
    if (auth !== null) return auth

    // 这两个地址只接 WebSocket，不兼前端路由（前端的对局页路由是 /match 不带房间码，
    // 正好落不进下面那条正则），所以非升级请求直接回 426 而不是回 index.html。
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
