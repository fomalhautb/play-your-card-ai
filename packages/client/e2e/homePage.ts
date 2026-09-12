/**
 * 端到端用例进首页要用的动作：等这一页上场、按坐标点菜单里的某一项。
 *
 * 首页整页画在画布上，DOM 里没有按钮，所以只能**真的用指针点**——
 * 和房间页那三颗钮是同一个办法（见 roomPage.ts 的文件头）。
 * 不同的是这里不抄一份版式公式：首页的版式是 canvas 导出的一个纯函数
 *（`pickHomeLayout`），菜单清单也在 canvas 里（`homeMenu`），
 * 所以用例直接调它们算出落点，版式改了这边自动跟着改。
 *
 * 首页从前还有一道等图闸门（十几张整幅图全部有结果之前只显示一条进度条），
 * 正式版简化第 4 步剥成素方块之后那批图删了、闸门也没了，
 * 所以这里等的就是画布本身——判据见下面的 `waitForScene`。
 */

import { type HomeMenuId, homeMenu, pickHomeLayout } from '@ai-duel/canvas'
import { expect, type Page } from '@playwright/test'
import { VIEWPORT } from './players'

/**
 * 菜单里某一项的中心（视口坐标）。
 *
 * `dev` 传 true：端到端跑的是开发服务器，`import.meta.env.DEV` 是 true，
 * 所以「测试对局」那一项在，整排的落点也因此和生产构建不同。
 */
function menuSpot(id: HomeMenuId): { x: number; y: number } {
  const menu = homeMenu(true)
  const layout = pickHomeLayout(
    VIEWPORT.width,
    VIEWPORT.height,
    menu.map((item) => item.label),
  )
  const index = menu.findIndex((item) => item.id === id)
  const rect = layout.menu[index]
  if (rect === undefined) throw new Error(`首页菜单里没有 ${id} 这一项`)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * 等某一页的场景**真的建出来**了。
 *
 * 光等 `<canvas>` 出现是不够的：那个元素是 React 一挂载就放进 DOM 的，而场景要等
 * 一个 await（装卡面图集）才建得起来。这中间点上去，
 * 点的是一块 300×150 的空画布——那是 `<canvas>` 没人管时的默认尺寸。
 *
 * 判据就是这个尺寸：Pixi 的渲染器一接手就会按 `autoDensity` 把 CSS 宽高写成视口那么大
 *（见各 *Stage 的 `resolution` 和 `autoDensity: true`）。所以「CSS 宽度不再是空的」
 * 等价于「渲染器已经接管了这块画布」，而这正是指针事件开始有人接的那一刻。
 *
 * 图集要现下，第一次进站要几秒，所以给足 60 秒（同对局那条用例的口径）。
 */
export async function waitForScene(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout: 60_000 })
  await page.waitForFunction(
    (one) => {
      const canvas = document.querySelector(one)
      return canvas instanceof HTMLCanvasElement && canvas.style.width !== ''
    },
    selector,
    { timeout: 60_000 },
  )
}

/** 开首页，等到场景真的建出来。 */
export async function openHome(page: Page): Promise<void> {
  await page.goto('/')
  await waitForScene(page, '.home-stage canvas')
}

/** 点首页菜单里的某一项。 */
export async function clickHomeMenu(page: Page, id: HomeMenuId): Promise<void> {
  const spot = menuSpot(id)
  await page.mouse.click(spot.x, spot.y)
}

/**
 * 从首页进一局测试对局，等到对局场景真的建出来。
 *
 * 点不中就重试两次：首页那颗钮是画在画布上的，用例看不见它到底摆好没有。
 * 判据是「跳到对局页了没有」，所以重试是安全的——已经跳走的话，
 * 第二次那一下点在对局界面的空地上（那个坐标落在战场上方的空处），什么都不会发生。
 */
export async function enterTestMatch(page: Page): Promise<void> {
  const stage = page.locator('.duel-stage canvas')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickHomeMenu(page, 'test')
    try {
      await stage.waitFor({ state: 'visible', timeout: 15_000 })
      break
    } catch {
      // 还在首页就再点一次。
    }
  }
  await expect(stage).toBeVisible({ timeout: 30_000 })
  await waitForScene(page, '.duel-stage canvas')
}
