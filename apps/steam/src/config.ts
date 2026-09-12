/**
 * 壳的几个开关。全部从环境变量和命令行读，没有一个写死在代码里——
 * 同一份构建产物要能指向线上、指向预发布、指向本机，换的只是启动方式。
 */

/**
 * 页面挂在哪个源下面。
 *
 * 打包之后页面**不是** `file://`，而是由主进程把本地构建产物「挂」到这个源上
 *（见 src/site.ts）。这么做只为一件事：**同源**。账号的会话在 cookie 里，
 * 而 cookie、CORS、better-auth 的来源检查全认源；`file://` 那边这三样一样都对不上，
 * 整条登录链会当场断掉（见 packages/client/src/net/endpoints.ts 的文件头）。
 *
 * 换个源是为了预发布和冒烟用例：冒烟那条指向一个**不存在**的域名，
 * 于是页面全从本地出、一条请求也打不到线上（见 e2e/smoke.spec.ts）。
 */
export const SITE_ORIGIN = process.env.AI_DUEL_ORIGIN ?? 'https://playyourcardai.online'

/**
 * Steam 的 appId。不配就是 480（Valve 的 SpaceWar）——每个 Steam 账号都「拥有」它，
 * 所以它是所有 Steam 接入的通用试验田，不用等自己的 appId 批下来就能把整条路跑通。
 *
 * 服务端那边也有一个同名的（`STEAM_APP_ID`，见 packages/server/env.d.ts）。
 * **两处必须填同一个数**：验票据时 Valve 会拿 appId 比对，对不上整张票作废。
 */
export const STEAM_APP_ID = Number(process.env.STEAM_APP_ID ?? '480')

/**
 * 取票据时告诉 Steam「这张票是发给谁的」。
 *
 * 服务端验票据时要传同一个字面量（packages/server/src/auth/steamTicket.ts 的
 * `STEAM_TICKET_IDENTITY`），对不上 Valve 会拒。两处各写一份是因为壳和服务端谁也不该依赖谁。
 */
export const STEAM_TICKET_IDENTITY = 'playyourcardai'

/** 命令行上指定开发服务器的那个参数。 */
const DEV_URL_FLAG = '--dev-url='

/**
 * 开发时直接加载的地址（`pnpm --filter @ai-duel/steam start` 会带上它）。
 * 没带就走「本地构建产物挂到 SITE_ORIGIN 上」那条。
 *
 * 用命令行参数而不是环境变量：`FOO=bar electron .` 这种写法在 Windows 的
 * cmd / PowerShell 里不成立，而壳本来就要在三个系统上都跑得起来。
 */
export function devUrl(): string | null {
  const flag = process.argv.find((arg) => arg.startsWith(DEV_URL_FLAG))
  return flag === undefined ? null : flag.slice(DEV_URL_FLAG.length)
}

/** 房间的 WebSocket 端点。房间码一定是四位数字，见 packages/server/src/index.ts。 */
const MATCH_PATH = /^\/match\/\d{4}\/?$/

/**
 * 这条路径该交给服务端，还是该从本地构建产物里拿。
 *
 * 名单抄自 `packages/server/wrangler.jsonc` 的 `run_worker_first` 和
 * `apps/web/vite.config.ts` 的代理表，三处是同一件事的三种写法，改一处要一起看。
 *
 * `/match` 那条**必须**写成带四位房间码的正则：`/match` 同时是前端的对局页路由，
 * 按前缀匹配的话玩家一进对局页就会被转给服务端，拿回一句「这个地址只接 WebSocket」。
 * `/room/*` 不在名单里——那是旧转发器的路径，正式版客户端一条都不发（第 38 条会删掉它）。
 */
export function isServerPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/lobby' || MATCH_PATH.test(pathname)
}
