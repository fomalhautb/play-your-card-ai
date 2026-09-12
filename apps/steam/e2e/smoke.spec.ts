/**
 * Steam 壳的冒烟用例：把打好的壳真的启动一次，看窗口开出来、首页画布画出来。
 *
 * 这一条守的是三件最容易在没人看的时候坏掉的事：
 * 1. 主进程起得来（Electron 版本、CommonJS 产物、`steamworks.js` 在没有 Steam 时不炸）；
 * 2. 本地构建产物真的被挂到了站点那个源上（src/site.ts 的协议处理器）——
 *    MIME 回错一个字，页面就是一片空白，而且只有一句 "Failed to load module script"；
 * 3. preload 那座桥挂上了，渲染进程拿到的是 Electron 那套平台实现。
 *
 * ## 为什么把源指到一个不存在的域名
 *
 * `AI_DUEL_ORIGIN` 指向 `https://smoke.invalid`（`.invalid` 是 RFC 2606 保留的顶级域，
 * 永远解析不出来）。这样页面照样有一个**真正的 https 源**（cookie、同源那套全成立），
 * 而 `/api/*` 那几条请求一条也出不去——用例因此既不依赖网络，也不会去打扰线上服务。
 * 账号登录会失败，但首页不等账号（见 packages/client/src/screens/HomeScreen.tsx）。
 *
 * ## 这一条只在本机跑，没进 CI
 *
 * 判据是「Pixi 的渲染器接管了那块画布」，也就是要**一个真的能用的 WebGL**。
 * GitHub 的跑机没有独显，而 Electron 里那套软件光栅的开关（`--use-angle=swiftshader`、
 * `app.disableHardwareAcceleration()` 几种组合都试过）在 Electron 44 上起不来渲染器——
 * 浏览器那边用的 `--use-gl=angle --use-angle=swiftshader`（见 packages/client/e2e/players.ts）
 * 在这儿不适用。所以慢档里只跑构建（第 37 条），这一条留给本机：
 * `pnpm --filter @ai-duel/steam smoke`。
 */

import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// `__dirname` 而不是 `import.meta.url`，理由见 e2e/playwright.config.ts。
const APP_ROOT = resolve(__dirname, '..')

/** 一个永远解析不出来的源，理由见文件头。 */
const OFFLINE_ORIGIN = 'https://smoke.invalid'

test('窗口开得出来，首页画布画得出来', async () => {
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, AI_DUEL_ORIGIN: OFFLINE_ORIGIN },
  })

  const page = await app.firstWindow()
  page.on('pageerror', (error) => console.log(`[渲染进程抛错] ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[渲染进程 console.error] ${message.text()}`)
  })

  try {
    // 页面真的跑在站点那个源上——这一条不成立的话，cookie 和同源请求全都不成立。
    await expect.poll(() => new URL(page.url()).origin).toBe(OFFLINE_ORIGIN)

    // 桥挂上了，而且是 electron 那一座（见 packages/platform/src/electron/bridge.ts）。
    const bridge = await page.evaluate(() => {
      const shell = (window as unknown as Record<string, { kind?: string } | undefined>).aiDuelShell
      return shell?.kind ?? null
    })
    expect(bridge).toBe('electron')

    /*
     * 等首页场景**真的建出来**，判据和端到端那边一样（packages/client/e2e/homePage.ts）：
     * `<canvas>` 是 React 一挂载就放进 DOM 的，而 Pixi 的渲染器接手时才会按 `autoDensity`
     * 把 CSS 宽高写成视口那么大。所以「CSS 宽度不再是空的」等价于「渲染器已经接管了」。
     */
    const canvas = page.locator('.home-stage canvas')
    await canvas.waitFor({ state: 'visible', timeout: 90_000 })
    await expect
      .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).style.width), {
        timeout: 90_000,
      })
      .not.toBe('')
  } finally {
    await app.close()
  }
})
