/**
 * 网络能力的 Capacitor 实现：改地址、HTTP 走原生、前后台切换问系统要。
 *
 * 三处都不是「网页那份在 WebView 里不能用」，而是「在手机壳里那份是错的」：
 *
 * 1. **地址**。页面的源是本机那个（`capacitor://localhost`），服务端在线上域名，
 *    客户端却是照 `window.location.origin` 拼地址的。理由和做法见 origin.ts 的文件头。
 * 2. **HTTP 走原生**。改完地址请求就是跨源的，浏览器那套 CORS 和「跨源不带 cookie」当场生效，
 *    而会话正是一个 cookie。`CapacitorHttp` 是 Capacitor 自带的原生 HTTP（不用另外装插件），
 *    请求由系统的网络栈发出，压根不经过 WebView 的同源策略，cookie 也存在系统的 cookie 罐里
 *    （iOS 的 `HTTPCookieStorage`、Android 的 `CookieManager`），跨重启还在。
 *    **只换 requestJson 这一个口子**，不开 `plugins.CapacitorHttp.enabled`——那个开关会把全局
 *    `fetch` 和 `XMLHttpRequest` 整个换掉，连 Pixi 读本地图集、howler 读本地音频都跟着走原生，
 *    风险远大于收益。
 * 3. **前后台**。网页那份听的是 `visibilitychange`，而 iOS 的 WKWebView 在应用被切到后台时
 *    不保证发这个事件。`@capacitor/app` 的 `appStateChange` 接的是系统那两条通知
 *    （iOS 的 didBecomeActive / willResignActive、Android 的 onResume / onStop），是准的。
 *    这件事要紧：切后台期间连接多半已经死了，切回来不主动探一探，玩家就是对着一条死连接干等
 *    （见 network.ts 里 onForeground 的说明）。
 *
 * WebSocket 仍然走 WebView 自己那条（partysocket），只把地址改掉：
 * WebSocket 不受 CORS 管，握手的凭据是子协议里那张 JWT 不是 cookie，所以它本来就没问题。
 */

import { App } from '@capacitor/app'
import { CapacitorHttp } from '@capacitor/core'
import type { HttpRequestOptions, NetworkCapability } from '../network'
import { httpUrl, socketUrl } from './origin'

export function createCapacitorNetwork(
  web: NetworkCapability,
  siteOrigin: string,
): NetworkCapability {
  return {
    // 只换地址，重连状态机还是网页那份（partysocket）。
    // `url` 是个函数、每次重连现调一次，所以这里也只能包一层函数。
    openSocket: (options) =>
      web.openSocket({ ...options, url: () => socketUrl(options.url(), siteOrigin) }),
    requestJson: (url, options) => requestJson(httpUrl(url, siteOrigin), options),
    onForeground,
  }
}

async function requestJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  // 已经取消过的就别发了。这一句要在建请求**之前**：`CapacitorHttp.request` 一调就出去了，
  // 后面那层 abortable 只能做到「不再等它」，收不回来。
  options.signal?.throwIfAborted()

  const response = await abortable(
    CapacitorHttp.request({
      url,
      method: options.method ?? 'GET',
      headers: { ...options.headers },
      // `body` 已经是序列化好的字符串了（见 network.ts 的 HttpRequestOptions）。
      // 原生那边对 application/json 的字符串是原样写进请求体的，不会再包一层。
      ...(options.body === undefined ? {} : { data: options.body }),
      responseType: 'json',
    }),
    options.signal,
  )

  // 和网页那份同一条口径：非 2xx 也当失败，调用方只在一处 catch。
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.data as T
}

/**
 * 给一个取消不了的 Promise 补上「取消」。
 *
 * `CapacitorHttp` 没有 AbortSignal 这个口子：请求已经交给系统的网络栈了，收不回来。
 * 能做到的只有「不再等它」——信号一响就让调用方那边立刻失败，真正的请求在后台跑完自己消失。
 * 对调用方来说差别只有一点点流量，而 `HttpRequestOptions.signal` 的语义（取消这次请求）
 * 在它那一侧是满足的。
 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * 应用回到前台。
 *
 * `addListener` 返回的是 Promise，而这一层的约定是「立刻返回退订函数」，所以退订要等那个
 * Promise 落地之后再摘。订阅刚发出去就退订是正常的（React 的 StrictMode 会这么干一次），
 * 那时监听器可能还没挂上——`then` 里再摘一次就对了。
 */
function onForeground(listener: () => void): () => void {
  const pending = App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) listener()
  })
  return () => {
    void pending.then((handle) => handle.remove())
  }
}
