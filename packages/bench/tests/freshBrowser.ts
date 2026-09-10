/**
 * 让每条 Playwright 用例各开一个**全新的浏览器进程**。
 *
 * Playwright 默认的做法是一个 worker 起一个浏览器，每条用例在这同一个浏览器里新建一个
 * 上下文。在 GitHub 的 ubuntu 跑机上（无头 `chrome-headless-shell` + SwiftShader 软件渲染）
 * 这条路走不通：**同一个浏览器进程里的第二次 `browser.newContext()` 会一直卡住**。
 *
 * 不是慢，是不返回。快档那次失败的运行（34474328868）里，每个 worker 的第一条用例
 * 4～6 秒就跑完了，紧跟着的第二条全部停在
 * `Test timeout of 120000ms exceeded while setting up "context"` 上，
 * 而那两分钟里浏览器一行日志都没再输出（上一条的上下文是正常关掉的，
 * 不然报的会是「tearing down context」）。一条用例超时后 Playwright 会换一个新 worker、
 * 也就是新浏览器，于是下一条又跑得过、再下一条又卡——7 条恰好 4 过 3 卡，
 * 顺序和「这条是不是所在浏览器里的第一条」严丝合缝。macOS 上复现不出来，
 * 它只在 Linux + SwiftShader 这套组合上出现。
 *
 * 所以这里把「一条用例 = 一个新浏览器」定成规矩：每条都退回到那个已知跑得通的状态。
 * 代价是每条多一次浏览器启动（跑机上一两秒），比卡两分钟再重启 worker 便宜得多。
 * **把超时调大治不了这个病**——卡住的那一次给多久都不会返回。
 *
 * 只换掉 `page` 这一个 fixture，用例照常写。副作用是绕开了 Playwright 按上下文收集的那套
 * 产物（trace、录像、失败截图）——这个包三样都没开，没有损失；关键帧的差异图挂在 testInfo 上，
 * 不走上下文，照旧能拿到。
 *
 * `timing.spec.ts` 没接这个：那一组有头、只在开发者本机（macOS）跑，碰不到这个坑，
 * 而且它量的是帧时间，多起几次浏览器只会往数字里掺噪声。
 */

import { test as base } from '@playwright/test'

export const test = base.extend({
  page: async (
    {
      playwright,
      browserName,
      baseURL,
      viewport,
      deviceScaleFactor,
      hasTouch,
      isMobile,
      contextOptions,
    },
    use,
  ) => {
    /*
     * `launch()` 故意不传参：Playwright 把配置里那套启动选项（headless、SwiftShader 那几个 args）
     * 挂在 `playwright._defaultLaunchOptions` 上，无参调用正好取到它——
     * 内置的 `browser` fixture 自己也是这么调的。手动再拼一遍反而会和配置走岔。
     */
    const browser = await playwright[browserName].launch()
    /*
     * 上下文选项得自己转发：内置的 `context` fixture 会把 `use:` / `test.use()` 里的那些逐项
     * 合并好，绕开它就得自己列。这里列的是这个包真的会用到的几项——`baseURL` 来自配置，
     * `hasTouch` / `isMobile` 来自交互用例里触屏那一组的 `test.use()`。
     * 以后在配置里加了别的上下文选项（locale、permissions 之类）要记得往这儿补一行，
     * 否则它会静悄悄地不生效。
     */
    const context = await browser.newContext({
      ...contextOptions,
      baseURL,
      viewport,
      deviceScaleFactor,
      hasTouch,
      isMobile,
    })
    try {
      await use(await context.newPage())
    } finally {
      // 用例失败或者超时时也要收掉，不然跑机上会攒下一串浏览器进程。
      await browser.close()
    }
  },
})

export { expect } from '@playwright/test'
