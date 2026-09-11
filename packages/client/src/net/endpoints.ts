/**
 * 服务端地址：两条 WebSocket，加上账号系统那三条 HTTP。
 * 路径由 `packages/server/src/index.ts` 的总路由和 better-auth 的 `basePath` 定死。
 *
 * 传进来的是 http(s) 源而不是 ws(s) 源：生产环境前端和服务端是同一个 Worker、
 * 同一个域名，调用方手上现成的就是页面的 origin。本地开发是两个进程
 *（Vite 一个端口、wrangler dev 另一个），但由 Vite 的 `server.proxy` 把这五条路径原样转给
 * wrangler，所以**浏览器看到的仍然是同源**，调用方照样传页面的 origin。
 *
 * 同源不只是省事：账号的会话在 cookie 里，跨源的话每条请求都要另外处理凭据和 CORS，
 * 而那恰恰是本地开发和线上唯一会分岔的地方（见 apps/web/vite.config.ts）。
 */

import type { RoomCode } from '@ai-duel/protocol'

/**
 * http→ws、https→wss，顺手去掉末尾的斜杠。
 *
 * 两种前缀只差开头的 `http`，所以替换那一段就够了；末尾斜杠在这里一次性去掉，
 * 拼路径的地方就不用各自防一次 `//`。
 */
function wsBase(origin: string): string {
  return origin.replace(/\/$/, '').replace(/^http/, 'ws')
}

/** 大厅：全局单实例的 Durable Object，连上拿房间码（见 server README「大厅」）。 */
export function lobbyUrl(origin: string): string {
  return `${wsBase(origin)}/lobby`
}

/** 房间：房间码就是那个对象的名字，所以它在路径里而不是查询参数里。 */
export function roomUrl(origin: string, code: RoomCode): string {
  return `${wsBase(origin)}/match/${code}`
}

/**
 * better-auth 的路由前缀。服务端那份写在 `src/auth/betterAuth.ts` 的 `AUTH_BASE_PATH`，
 * 两处必须一样——跨包只走包入口（架构 7.2 第 2 条），而 `server` 不是 `client` 的依赖，
 * 所以只能各写一份，改一处要一起改。
 */
const AUTH_BASE = '/api/auth'

/** 末尾斜杠一次性去掉，下面三条拼路径时就不用各自防一次 `//`。 */
function httpBase(origin: string): string {
  return origin.replace(/\/$/, '')
}

/** 当前会话。没登录过时服务端回的是 `null` 而不是错，所以它同时是「进过站没有」的判据。 */
export function sessionUrl(origin: string): string {
  return `${httpBase(origin)}${AUTH_BASE}/get-session`
}

/** 开一个游客账号。会话落在 cookie 里，所以这条请求必须和页面同源。 */
export function signInAnonymousUrl(origin: string): string {
  return `${httpBase(origin)}${AUTH_BASE}/sign-in/anonymous`
}

/**
 * 拿 Steam 票据换会话（迁移第 35 条，只有 Steam 壳走得到）。
 *
 * 和游客那条是**同一种东西**：进来之后都是一个会话 cookie，后面换 JWT、握手、认座位
 * 全都一模一样。服务端那半边是 better-auth 的一个插件（server 的 src/auth/steam.ts）。
 */
export function signInSteamUrl(origin: string): string {
  return `${httpBase(origin)}${AUTH_BASE}/sign-in/steam`
}

/** 用会话换一张握手用的短时效 JWT（默认十五分钟）。 */
export function tokenUrl(origin: string): string {
  return `${httpBase(origin)}${AUTH_BASE}/token`
}

/**
 * 登出：让服务端把会话 cookie 清掉。账号页那颗「登出」走它。
 *
 * 和上面三条一样必须同源——清的是 cookie，跨源的话浏览器根本不会带着它发过去。
 * 清完之后**要整页重载**，理由见 screens/AccountScreen.tsx 的文件头。
 */
export function signOutUrl(origin: string): string {
  return `${httpBase(origin)}${AUTH_BASE}/sign-out`
}
