/**
 * 把本地的前端构建产物「挂」到线上那个源下面。
 *
 * ## 为什么不直接 `file://`
 *
 * 账号的会话在 cookie 里，而 cookie、CORS、better-auth 的来源检查全都认**源**。
 * 页面要是 `file://`，`window.location.origin` 是 `"file://"`，
 * 发给 `https://playyourcardai.online/api/...` 的请求是跨源的，cookie 根本不会带上，
 * better-auth 的来源检查也会把它挡掉——整条登录链当场断掉。
 * 客户端那一层压根没有 `credentials` 这个口子，也是同一条前提的一部分
 *（见 packages/platform 的 network.ts 和 packages/client/src/net/endpoints.ts）。
 *
 * ## 做法
 *
 * `protocol.handle('https', ...)` 把 https 整个接管过来，然后分三种情况：
 * - 是我们这个源、而且路径不属于服务端 → 从 `dist/renderer` 里拿一个文件（匹配不到回 index.html）；
 * - 是我们这个源、但路径属于服务端（`/api/*`、`/lobby`、`/match/1234`）→ 照常走网络；
 * - 别的源（字体、CDN）→ 照常走网络。
 *
 * 页面于是**真的**跑在 `https://playyourcardai.online` 这个源上：cookie、同源请求、
 * WebSocket 一样都不用改。和本地开发时 Vite 的那份代理是同一个思路（apps/web/vite.config.ts），
 * 只是这边把「前端从哪来」换成了本地磁盘。
 *
 * WebSocket **不经过**协议处理器（Chromium 的 `wss://` 走另一条路），所以两条长连接
 * 一直是真的网络连接，这里不用为它们做任何事。
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { net, protocol } from 'electron'
import { isServerPath, SITE_ORIGIN } from './config'

/**
 * 扩展名到 MIME 的对照表。
 *
 * 必须自己给，不能让它空着：浏览器对 `<script type="module">` 的 MIME 是**强制**的，
 * 回错了整个应用一行都跑不起来（而且报错只有一句 "Failed to load module script"）。
 * 表里这几种就是构建产物里实际会出现的全部：Vite 打出来的 js/css/html、
 * 图集的 webp 和 json、音频的 m4a、站点图标。
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
}

function mimeOf(file: string): string {
  const dot = file.lastIndexOf('.')
  return (
    (dot === -1 ? undefined : MIME[file.slice(dot).toLowerCase()]) ?? 'application/octet-stream'
  )
}

/**
 * 把 URL 上的路径变成磁盘上的文件路径，越界的一律回 null。
 *
 * 越界检查不是多余的：这个处理器接管的是**整个 https**，别的源上的页面理论上也能
 * 构造出带 `..` 的地址打过来。`normalize` 之后必须还在根目录里面。
 */
function resolveFile(root: string, pathname: string): string | null {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '')
  const file = join(root, relative)
  if (file !== root && !file.startsWith(root + sep)) return null
  return existsSync(file) && statSync(file).isFile() ? file : null
}

/** 用流回一个文件，别把几兆的图集整个读进内存。 */
function fileResponse(file: string): Response {
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
  return new Response(body, { headers: { 'Content-Type': mimeOf(file) } })
}

/**
 * 装上处理器。`root` 是前端构建产物的目录（`dist/renderer`）。
 *
 * 必须在 `app.whenReady()` 之后、开窗口之前调。
 */
export function serveSiteFromDisk(root: string): void {
  const index = join(root, 'index.html')
  if (!existsSync(index)) {
    throw new Error(`找不到前端构建产物（${index}），先跑 pnpm --filter @ai-duel/steam build`)
  }

  protocol.handle('https', async (request) => {
    const url = new URL(request.url)
    // 不是我们这个源、或者这条路径归服务端管，就原样走网络。
    // `bypassCustomProtocolHandlers` 不加的话这一句会重新进到这个处理器里，无限套娃。
    if (url.origin !== SITE_ORIGIN || isServerPath(url.pathname)) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true })
    }

    const file = resolveFile(root, url.pathname)
    if (file !== null) return fileResponse(file)
    /*
     * 磁盘上没有这个文件 → 回 index.html。
     *
     * 前端是单页应用，`/deck`、`/account` 这些路径在磁盘上本来就没有对应文件，
     * 由前端路由自己认（和 wrangler.jsonc 里 `not_found_handling: single-page-application` 一回事）。
     */
    return fileResponse(index)
  })
}
