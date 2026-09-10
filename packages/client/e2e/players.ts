/**
 * 联机用例要的两个「玩家」：**各自一个浏览器进程**，不是一个浏览器里的两个上下文。
 *
 * ## 为什么非得开两个浏览器
 *
 * 两个上下文同源，Chromium 会把它们放进同一个渲染进程、共用同一个 GPU 进程。
 * 而这两页各挂着一块 1280×900 的 Pixi 画布，光是建场景那一下（烤界面纹理）就要占住
 * 主线程一阵子。本机实测：只有一页时，进房之后一次 `page.evaluate` 要 1.1 秒；
 * 开着两页时同一句要 **11 秒**——超线性地退化，而用例里每一步都要 evaluate 一次。
 * 表现出来就是「点了没反应」「等 30 秒还没等到」，而且时快时慢。
 * 换成两个浏览器之后，同一句稳定在个位数毫秒。
 *
 * 代价是多一个浏览器进程和一次冷启动（几百毫秒），换来的是这两条用例能稳定跑完。
 *
 * ## 视口和启动参数为什么写在这里
 *
 * 用例自己开浏览器，配置里 `use` 那几项（viewport、trace、launchOptions）就管不到它们了，
 * 所以这里要自己给全。视口尤其要紧：房间页那几颗钮的坐标是按 1280×900 算出来的
 *（见 roomPage.ts），换个视口就全点空了。
 *
 * trace 这里一律不录：我们自己开的上下文默认就不录，而这两页的界面一个 DOM 节点都没有，
 * trace 里只有一个空的 `<canvas>`，本来也看不出什么（真要查问题看用例打出来的那份状态）。
 */

import { type Browser, chromium, type Page } from '@playwright/test'

/**
 * 浏览器启动参数。和组件目录页那边同一套：走 ANGLE 的 SwiftShader 后端，
 * 没有独显的跑机也能跑 WebGL，而对局界面整个画在画布上，没有 WebGL 就什么都看不见。
 */
export const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
]

/** 视口。短边 900 > 断点 768，走的是有侧栏的那一档（见 canvas 的 pickLayout）。 */
export const VIEWPORT = { width: 1280, height: 900 }

export interface Player {
  browser: Browser
  page: Page
  /** 把这一端断网 / 恢复。断的是整个上下文，连 WebSocket 一起。 */
  setOffline(offline: boolean): Promise<void>
  close(): Promise<void>
}

/**
 * 开一个玩家：一个浏览器、一个上下文（也就是一份自己的 cookie，也就是一个游客账号）。
 *
 * `tag` 只进日志（「A」「B」）。页面里抛的错和 console.error 一律原样打出来——
 * 两个浏览器各跑各的，出了事在跑批器这边一个字都看不见，光靠「等不到某个元素」
 * 根本判不出是哪一端出的问题。
 */
export async function openPlayer(tag: string): Promise<Player> {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log(`[${tag}] 页面抛错：${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[${tag}] console.error：${message.text()}`)
  })
  return {
    browser,
    page,
    setOffline: (offline) => context.setOffline(offline),
    close: () => browser.close(),
  }
}
