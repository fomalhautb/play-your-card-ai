/**
 * 从页面上那个调试口子（`window.__aiDuel`，见 src/dev/debugHook.ts）读一份状态。
 *
 * 两件事这里一起办了，因为拆开会漏：
 *
 * 1. **等它挂上来**。挂钩子是异步的：那个模块由一句 `import.meta.env.DEV` 守着的
 *    **动态** import 拉进来，所以画布已经画出来了、口子还可能差半拍。
 * 2. **等和读要在同一次轮询里**。先 `waitForFunction` 确认它在、再 `evaluate` 去读的话，
 *    中间那一下页面要是重载了（开发服务器重新预构建依赖时会整页刷新），
 *    读到的就是一个已经没有钩子的新页面，报出来是一句莫名其妙的「刚才还在，现在没了」。
 *    `waitForFunction` 自己就能把值带回来，一次轮询里读完，压根没有这个缝。
 */

import type { Page } from '@playwright/test'

/** 等到口子挂上来并读一份状态。默认等到 30 秒——第一次进站还要开一个游客号，没那么快。 */
export async function readDebug<T>(page: Page, slot: 'room' | 'match'): Promise<T> {
  const handle = await page.waitForFunction(
    (which) => window.__aiDuel?.[which]?.view() ?? null,
    slot,
    { timeout: 30_000 },
  )
  return (await handle.jsonValue()) as T
}

/** 口子在不在。要发指令的地方先问一句，不在就当这一步什么都没做（多半是页面刚重载）。 */
export async function hasDebug(page: Page, slot: 'room' | 'match'): Promise<boolean> {
  return await page.evaluate((which) => window.__aiDuel?.[which] !== undefined, slot)
}
