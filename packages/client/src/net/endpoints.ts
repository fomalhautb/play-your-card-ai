/**
 * 服务端的两条 WebSocket 地址。路径由 `packages/server/src/index.ts` 的总路由定死。
 *
 * 传进来的是 http(s) 源而不是 ws(s) 源：生产环境前端和服务端是同一个 Worker、
 * 同一个域名，调用方手上现成的就是页面的 origin。本地开发是两个进程
 * （Vite 一个端口、wrangler dev 另一个），那时由应用入口把 origin 换成 wrangler 的地址。
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
