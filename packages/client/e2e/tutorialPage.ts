/**
 * 新手教程那条端到端用例要用的动作：进教程、读当前步骤、点某一块。
 *
 * 三段教学里**点的全是真指针**（组牌、选英雄、对战三页都整个画在画布上，DOM 里没有元素），
 * 落点从调试口子读——`window.__aiDuel.tutorial` 回答「停在哪一步、要圈哪几块、
 * 某个语义锚点在哪儿」，那几块正是引导层此刻圈着的地方（两边问的是同一个函数，
 * 见 client 的 screens/TutorialDeckPhase.tsx 等）。
 *
 * 「下一步」那颗钮是例外：引导层是 React 的，那是一颗真按钮，按名字点就行。
 */

import { homeMenu, pickHomeLayout } from '@ai-duel/canvas'
import { expect, type Page } from '@playwright/test'
// 这一句同时把 src/dev/debugHook 里那份 `declare global`（window.__aiDuel）带进来。
import type { DebugRect, TutorialDebug } from '../src/dev/debugHook'
import { openHome, waitForScene } from './homePage'
import { VIEWPORT } from './players'

/** 教程此刻停在哪一段、哪一步。从调试口子的签名反推，那边改了这里跟着变。 */
export type TutorialSnapshot = ReturnType<TutorialDebug['view']>

/**
 * 首页那颗「开始游戏」的中心。
 *
 * 和菜单那几项一样按 canvas 导出的版式函数算（理由见 homePage.ts）：
 * 它是主入口，不在 `homeMenu` 那张清单里，所以单独算一次。
 * `dev` 传 true：端到端跑的是开发服务器，菜单上多一项「测试对局」，整排的落点也因此不同。
 */
function startSpot(): { x: number; y: number } {
  const layout = pickHomeLayout(
    VIEWPORT.width,
    VIEWPORT.height,
    homeMenu(true).map((item) => item.label),
  )
  const rect = layout.start
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * 从首页进教程，等到第一段（组牌）的画布真的建出来。
 *
 * 「开始游戏」按存档里的 `tutorialDone` 分流（见 screens/HomeScreen.tsx），
 * 新开的浏览器上下文是干净的，所以它指向 `/tutorial`。
 * 点不中就重试两次：那颗钮画在画布上，用例看不见它到底摆好没有（同 homePage 的 enterTestMatch）。
 */
export async function enterTutorial(page: Page): Promise<void> {
  await openHome(page)
  const spot = startSpot()
  const start = page.getByRole('button', { name: '开始教学' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.mouse.click(spot.x, spot.y)
    try {
      await start.waitFor({ state: 'visible', timeout: 15_000 })
      break
    } catch {
      // 还在首页就再点一次。
    }
  }
  await expect(start).toBeVisible({ timeout: 30_000 })
  await start.click()
  await waitForScene(page, '.deck-stage canvas')
}

/**
 * 读一份教程状态。**读不到就是 null**，不等——两种情况都会读到 null，
 * 而它们都不是错误：口子是异步挂上来的（动态 import），以及三段教学都走完之后
 * 换到完成页，那一屏没有这个口子。调用方自己决定是接着等还是收工。
 */
export async function tutorialState(page: Page): Promise<TutorialSnapshot | null> {
  return await page.evaluate(() => window.__aiDuel?.tutorial?.view() ?? null)
}

/** 等教程走到某一步。超时会把最后读到的那份状态原样打出来。 */
export async function untilStep(page: Page, step: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await tutorialState(page)), { timeout })
    .toContain(`"step":"${step}"`)
}

/** 这一步引导层圈着的那几块。还没量出来（场景刚建好）时是空数组。 */
async function targets(page: Page): Promise<DebugRect[]> {
  return await page.evaluate(() => window.__aiDuel?.tutorial?.targets() ?? [])
}

/** 某个语义锚点现在占哪一块，**答不上来就是 null，不等**。只有对战那一段答得上来。 */
export async function anchorRect(page: Page, name: string): Promise<DebugRect | null> {
  return await page.evaluate((one) => window.__aiDuel?.tutorial?.anchor(one) ?? null, name)
}

/**
 * 等一块矩形真的量出来。
 *
 * 不能读一次就点：引导层的位置是每帧现量的，场景刚建出来那几帧还是空的
 *（见 ui 的 TutorialOverlay），而锚点在换版式、换步骤的那一拍也可能暂时答不上来。
 */
async function waitForRect(
  page: Page,
  read: () => Promise<DebugRect | null>,
  what: string,
): Promise<DebugRect> {
  await expect.poll(async () => (await read()) !== null, { timeout: 30_000 }).toBe(true)
  const rect = await read()
  if (rect === null) throw new Error(`${what} 还是答不上来`)
  return rect
}

/** 点某一块的正中。 */
export async function clickRect(page: Page, rect: DebugRect): Promise<void> {
  await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2)
}

/** 点这一步圈着的第一块（组牌那三张卡、选英雄那张卡都走它）。 */
export async function clickFirstTarget(page: Page): Promise<void> {
  const rect = await waitForRect(
    page,
    async () => (await targets(page))[0] ?? null,
    '这一步圈的地方',
  )
  await clickRect(page, rect)
}

/** 点某个语义锚点的正中（对战那一段的「结束出牌」「对方战场」都走它）。 */
export async function clickAnchor(page: Page, name: string): Promise<void> {
  const rect = await waitForRect(page, () => anchorRect(page, name), `锚点 ${name}`)
  await clickRect(page, rect)
}
