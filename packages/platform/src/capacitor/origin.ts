/**
 * 把客户端算出来的地址改指到线上那个源。
 *
 * ## 为什么手机壳非得做这件事
 *
 * 客户端拼服务端地址时用的是 `window.location.origin`（见 packages/client/src/net/endpoints.ts）。
 * 网页壳和 Steam 壳里这一条成立：网页本来就在线上那个域名下，Steam 壳则是主进程用
 * `protocol.handle('https')` 把本地产物挂到线上那个源上，硬把 origin 做成了线上域名。
 *
 * Capacitor 里这一招**做不到**，两条路都堵死了：
 * - iOS 的 WKWebView 不允许给 http / https 注册自定义协议处理器，所以 `server.iosScheme`
 *   只能是 `capacitor` 这类非标准 scheme，页面的源必然是 `capacitor://localhost`；
 * - Android 上 `server.hostname` 虽然可以填线上域名，但 Capacitor 的本地服务器是按**主机名**
 *   拦截的（`WebViewLocalServer.isMainUrl`），填了之后连 `/api/*` 一起被拦进本地产物里，
 *   登录那几条请求根本出不去。
 *
 * 所以手机壳里页面的源固定是本机那个（`capacitor://localhost` / `https://localhost`），
 * 而服务端在 `playyourcardai.online`。改地址这件事放在平台层做，客户端那边一行都不用改。
 *
 * ## 代价
 *
 * 改完地址，请求对浏览器来说就是**跨源**的：会话那几条要带 cookie，跨源的 `fetch` 默认不带，
 * better-auth 的来源检查也会挡。绕开这一层的办法见同目录 network.ts 的文件头（走原生 HTTP），
 * 还剩下的那半个问题写在 apps/mobile/README.md 的「同源这件事」。
 */

/** 线上那个源。预发布环境用 `createCapacitorPlatform({ siteOrigin })` 换。 */
export const DEFAULT_SITE_ORIGIN = 'https://playyourcardai.online'

/**
 * 这条地址是不是「页面自己那个源」。
 *
 * 两条都要成立：主机名是 `localhost`（Capacitor 本地服务器写死的），而且**没有端口**。
 * 端口这条是分开发和生产的：开发时 `server.url` 指向 Vite 开发服务器，那边自带代理、
 * 本来就是同源的（和网页壳一样），一改反而全指错；而开发服务器必然带端口。
 */
function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' && url.port === ''
}

/**
 * 换掉源，路径和查询原样保留。
 *
 * 认不出来的地址（不是合法 URL）原样返回：这一层的职责只有「改源」，
 * 地址本身对不对是调用方的事，在这里抛错只会把错误现场挪到离原因更远的地方。
 */
function withOrigin(raw: string, origin: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  if (!isLocal(url)) return raw
  return `${origin}${url.pathname}${url.search}`
}

/** 账号那几条 HTTP 请求的地址。 */
export function httpUrl(raw: string, siteOrigin: string): string {
  return withOrigin(raw, siteOrigin)
}

/**
 * 两条 WebSocket 的地址。
 *
 * 客户端那边已经把 `http` 换成了 `ws`（`endpoints.ts` 的 `wsBase`），但它换的是**页面的源**，
 * 在手机壳里那是 `capacitor://localhost`——开头不是 `http`，那一步什么也没换到。
 * 所以这里从线上那个 http(s) 源重新换一次，而不是指望传进来的地址已经是 ws 开头的。
 */
export function socketUrl(raw: string, siteOrigin: string): string {
  return withOrigin(raw, siteOrigin.replace(/^http/, 'ws'))
}
