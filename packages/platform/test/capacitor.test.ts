// @vitest-environment happy-dom

/**
 * Capacitor 平台的三处覆盖（迁移第 36 条）。
 *
 * 要 DOM 环境：这一套以网页实现为底，而网页实现一建出来就会去碰 `document` 和 `navigator`。
 * 三个 Capacitor 模块整个换成假的（`vi.mock`）——真模块在 Node 里只会退化成一堆
 * 「这个平台没实现」的空操作，测不出「有没有调到它」这件唯一值得测的事。
 *
 * 最要紧的是地址那一组：手机壳里页面的源是 `capacitor://localhost`，而服务端在线上域名，
 * 改错了整条登录链和两条 WebSocket 全都指错地方，而这件事在本机是跑不出来的
 *（见 src/capacitor/origin.ts 的文件头）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpRequestOptions, SocketHandle, SocketOptions } from '../src/index'
import { createCapacitorPlatform } from '../src/index'

const SITE = 'https://playyourcardai.online'

/** 当前这一条用例里算不算「跑在原生壳里」。 */
let native = true
/** `CapacitorHttp.request` 下一次要回什么。 */
let httpResponse: { status: number; data: unknown } = { status: 200, data: { ok: true } }
/** `CapacitorHttp.request` 收到的参数，按顺序。 */
let httpCalls: Record<string, unknown>[] = []
/** `SystemBars.hide()` / `show()` 的调用记录，`true` 是藏。 */
let barCalls: boolean[] = []
/** 触感插件收到的调用，形如 `impact:HEAVY`。 */
let hapticCalls: string[] = []
/** `App.addListener` 挂上的前后台监听器。 */
let appListeners: ((state: { isActive: boolean }) => void)[] = []
/** `handle.remove()` 被调过几次。 */
let appRemoves = 0

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
  CapacitorHttp: {
    request: (options: Record<string, unknown>) => {
      httpCalls.push(options)
      return Promise.resolve({ ...httpResponse, headers: {}, url: String(options.url) })
    },
  },
  SystemBars: {
    hide: () => {
      barCalls.push(true)
      return Promise.resolve()
    },
    show: () => {
      barCalls.push(false)
      return Promise.resolve()
    },
  },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, listener: (state: { isActive: boolean }) => void) => {
      appListeners.push(listener)
      return Promise.resolve({
        remove: () => {
          appRemoves += 1
          return Promise.resolve()
        },
      })
    },
  },
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: (options: { style: string }) => {
      hapticCalls.push(`impact:${options.style}`)
      return Promise.resolve()
    },
    selectionChanged: () => {
      hapticCalls.push('selection')
      return Promise.resolve()
    },
    notification: (options: { type: string }) => {
      hapticCalls.push(`notification:${options.type}`)
      return Promise.resolve()
    },
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}))

beforeEach(() => {
  native = true
  httpResponse = { status: 200, data: { ok: true } }
  httpCalls = []
  barCalls = []
  hapticCalls = []
  appListeners = []
  appRemoves = 0
})

afterEach(() => {
  // 只有开 WebSocket 那两条用例会打开假时钟（partysocket 建连接前要等一轮退避）。
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * 开一条 WebSocket，回答「传给原生 WebSocket 的地址是哪一条」。
 *
 * 底下是 partysocket（网页实现那份没换掉），它建连接前先等一轮退避，所以要推假时钟。
 * 退避压到 1 毫秒，不然默认那半秒会让每条用例都白等。
 */
async function openedUrl(url: string): Promise<string | undefined> {
  const urls: string[] = []
  class FakeSocket {
    constructor(socketUrl: string) {
      urls.push(socketUrl)
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  const platform = createCapacitorPlatform({ network: { webSocket: FakeSocket } })
  const options: SocketOptions = { url: () => url, minReconnectDelayMs: 1 }
  const handle: SocketHandle = platform.network.openSocket(options)
  await vi.advanceTimersByTimeAsync(50)
  handle.close()
  return urls[0]
}

describe('不在原生壳里跑的时候', () => {
  it('退回纯网页实现', async () => {
    native = false
    const platform = createCapacitorPlatform()
    // 网页实现在 happy-dom 里问得到 document.fullscreenEnabled（它是 false），
    // 而 Capacitor 实现恒为 true——用这一项分得出走的是哪一条。
    expect(platform.fullscreen.isSupported()).toBe(false)
    // 手机上没有 Steam，这一项在哪条分支上都该是 undefined。
    expect(platform.steam).toBeUndefined()

    // 换掉全局 fetch，既是断言也是防线：不换的话这一条会真的往外发一次请求。
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchSpy)
    await platform.network.requestJson('https://example.com/x')
    // 走的是网页实现那条 fetch，一条都没进原生 HTTP，地址也没被改指线上。
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(httpCalls).toEqual([])
  })
})

describe('地址改指线上', () => {
  it('HTTP：页面那个源换成线上，路径和查询原样留着', async () => {
    const platform = createCapacitorPlatform()
    await platform.network.requestJson('capacitor://localhost/api/auth/get-session?a=1')
    expect(httpCalls[0]?.url).toBe(`${SITE}/api/auth/get-session?a=1`)
  })

  it('WebSocket：客户端没换成的那半步在这儿补上', async () => {
    vi.useFakeTimers()
    // 客户端拼地址时把页面源里的 `http` 换成 `ws`，而 `capacitor://` 开头不是 http，
    // 那一步什么也没换到——传进来的就是这条。
    const opened = await openedUrl('capacitor://localhost/match/1234')
    expect(opened).toBe(`${SITE.replace(/^http/, 'ws')}/match/1234`)
  })

  it('安卓那边页面源是 https://localhost，同样要换', async () => {
    vi.useFakeTimers()
    expect(await openedUrl('wss://localhost/lobby')).toBe('wss://playyourcardai.online/lobby')
  })

  it('开发服务器（带端口的 localhost）不动它', async () => {
    const platform = createCapacitorPlatform()
    // 真机调试时 server.url 指向局域网上的 Vite，那边自带代理、本来就是同源的。
    await platform.network.requestJson('http://192.168.1.7:5176/api/auth/token')
    expect(httpCalls[0]?.url).toBe('http://192.168.1.7:5176/api/auth/token')

    await platform.network.requestJson('http://localhost:5176/api/auth/token')
    expect(httpCalls[1]?.url).toBe('http://localhost:5176/api/auth/token')
  })

  it('换源那一步可以指到别处（预发布）', async () => {
    const platform = createCapacitorPlatform({ siteOrigin: 'https://staging.example.com' })
    await platform.network.requestJson('capacitor://localhost/api/auth/token')
    expect(httpCalls[0]?.url).toBe('https://staging.example.com/api/auth/token')
  })
})

describe('HTTP 走原生', () => {
  it('请求体原样传下去，非 2xx 当失败', async () => {
    const platform = createCapacitorPlatform()
    const options: HttpRequestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"阿黄"}',
    }
    await platform.network.requestJson('capacitor://localhost/api/auth/sign-in/anonymous', options)
    expect(httpCalls[0]).toMatchObject({ method: 'POST', data: '{"name":"阿黄"}' })

    httpResponse = { status: 401, data: null }
    await expect(platform.network.requestJson('capacitor://localhost/api/x')).rejects.toThrow(
      'HTTP 401',
    )
  })

  it('已经取消过的请求不发出去', async () => {
    const platform = createCapacitorPlatform()
    const controller = new AbortController()
    controller.abort()
    await expect(
      platform.network.requestJson('capacitor://localhost/api/x', { signal: controller.signal }),
    ).rejects.toBeDefined()
    expect(httpCalls).toEqual([])
  })
})

describe('前后台走系统那条通知', () => {
  it('只在回到前台时回调，退订之后摘掉监听器', async () => {
    const platform = createCapacitorPlatform()
    let seen = 0
    const stop = platform.network.onForeground(() => {
      seen += 1
    })
    // 订阅是异步挂上去的（插件的 addListener 返回 Promise），等它落地。
    await Promise.resolve()

    appListeners[0]?.({ isActive: false })
    expect(seen).toBe(0)
    appListeners[0]?.({ isActive: true })
    expect(seen).toBe(1)

    stop()
    await Promise.resolve()
    expect(appRemoves).toBe(1)
  })
})

describe('全屏是藏系统栏', () => {
  it('一进来就是藏着的，退出再进出各调一次插件', async () => {
    const platform = createCapacitorPlatform()
    // capacitor.config.ts 里 SystemBars.hidden 为 true，应用启动时两条栏就藏好了。
    expect(platform.fullscreen.isActive()).toBe(true)

    const seen: boolean[] = []
    const stop = platform.fullscreen.onChange((value) => seen.push(value))
    await platform.fullscreen.exit()
    expect(await platform.fullscreen.enterLandscape()).toBe(true)
    stop()
    await platform.fullscreen.exit()

    expect(barCalls).toEqual([false, true, false])
    // 退订之后那一次不该再收到。
    expect(seen).toEqual([false, true])
  })

  it('不走页面的全屏 API', async () => {
    const request = vi.fn(() => Promise.resolve())
    Object.assign(document.documentElement, { requestFullscreen: request })
    const platform = createCapacitorPlatform()

    await platform.fullscreen.exit()
    await platform.fullscreen.enterLandscape()
    expect(request).not.toHaveBeenCalled()
  })

  it('方向是原生工程锁死的，也不该再劝玩家进全屏', () => {
    const platform = createCapacitorPlatform()
    expect(platform.fullscreen.isSupported()).toBe(true)
    // 锁不了方向：屏幕根本转不到竖的，竖屏提示那颗「一键横屏」按钮于是不出现。
    expect(platform.fullscreen.canLockOrientation()).toBe(false)
    expect(platform.fullscreen.isStandalone()).toBe(true)
  })
})

describe('触感', () => {
  it('三种反馈各转发成插件的一条调用', () => {
    const vibrate = vi.fn()
    Object.assign(navigator, { vibrate })
    const platform = createCapacitorPlatform()

    expect(platform.haptics.isSupported()).toBe(true)
    platform.haptics.impact('light')
    platform.haptics.impact()
    platform.haptics.selection()
    platform.haptics.notification('error')

    expect(hapticCalls).toEqual([
      'impact:LIGHT',
      'impact:MEDIUM',
      'selection',
      'notification:ERROR',
    ])
    // 关键是这一条：沿用网页实现的话安卓上会走 navigator.vibrate，
    // 手感只有「震多少毫秒」，iPhone 上更是一点反应都没有。
    expect(vibrate).not.toHaveBeenCalled()
  })
})
