/**
 * 联机端到端要用的房间页动作：点那三颗钮、读房间码、点准备。
 *
 * 三颗钮**真的用指针点**（房间页整页画在画布上，DOM 里没有按钮），
 * 所以这里要算出它们在屏幕上的位置。算法和 canvas 的 scenes/room/roomPanel.ts 一一对应，
 * 那边改了版式这里要跟着改——这是画布界面做端到端绕不开的代价，
 * 单机那条用例算手牌位置时也是同一个办法（见 localMatch.spec.ts 的 FAN）。
 *
 * 房间码反过来只能从调试口子读：那几个字是烤成纹理画上去的，页面上取不到文本。
 */

import { expect, type Page } from '@playwright/test'
// 这一句同时把 src/dev/debugHook 里那份 `declare global`（window.__aiDuel）带进来。
import type { RoomDebug } from '../src/dev/debugHook'
import { readDebug } from './debugBridge'

/** 房间页此刻的状态。从调试口子的签名反推，那边改了这里跟着变。 */
type RoomSnapshot = ReturnType<RoomDebug['view']>

/**
 * 等这一页的状态满足某个条件。
 *
 * 比的是整份状态序列化之后的字符串而不是单看某一项：等超时了，Playwright 会把最后拿到的
 * 那个值原样打出来，而这一页失败时最有用的线索——那句 `notice`（大厅报的错、房间收摊的原因）
 * ——正好也在这份状态里。只看某一项的话，失败信息永远只有一句「它还是 null」。
 */
async function untilRoom(page: Page, pattern: RegExp, timeout = 30_000): Promise<void> {
  await expect.poll(async () => JSON.stringify(await roomView(page)), { timeout }).toMatch(pattern)
}

/**
 * 按 1280×900 的视口算出来的面板几何（公式见 canvas 的 scenes/room/roomPanel.ts）：
 *
 *   面板 `min(560, 1280-64) × min(400, 900-64)` = 560×400，在视口正中 →
 *   左上角 (360, 250)；
 *   按钮是「结束出牌」那一档 184×60，离面板底边 30，竖排时上下间距 14。
 */
const PANEL = { x: 360, y: 250, width: 560, height: 400 }
const BUTTON = { width: 184, height: 60, gapY: 14, gapX: 20, bottom: 30 }

/** 竖排那一档（三颗）里第 index 颗的中心。index 0 是最上面那颗。 */
function columnSpot(index: number, count: number): { x: number; y: number } {
  const bottom = PANEL.height - BUTTON.bottom
  const top = bottom - count * BUTTON.height - (count - 1) * BUTTON.gapY
  return {
    x: PANEL.x + PANEL.width / 2,
    y: PANEL.y + top + index * (BUTTON.height + BUTTON.gapY) + BUTTON.height / 2,
  }
}

/** 并排那一档（两颗）里第 index 颗的中心。index 0 是左边那颗。 */
function rowSpot(index: number, count: number): { x: number; y: number } {
  const total = count * BUTTON.width + (count - 1) * BUTTON.gapX
  const left = (PANEL.width - total) / 2
  return {
    x: PANEL.x + left + index * (BUTTON.width + BUTTON.gapX) + BUTTON.width / 2,
    y: PANEL.y + PANEL.height - BUTTON.bottom - BUTTON.height / 2,
  }
}

/** 三颗入口钮，竖着排（`phase: 'idle'`）。 */
const ENTRY = { match: columnSpot(0, 3), create: columnSpot(1, 3), join: columnSpot(2, 3) }
/** 房里那两颗，并排（`phase: 'room'`）。 */
const IN_ROOM = { ready: rowSpot(0, 2), leave: rowSpot(1, 2) }

/** 读这一页此刻的状态。 */
export async function roomView(page: Page): Promise<RoomSnapshot> {
  return await readDebug<RoomSnapshot>(page, 'room')
}

/**
 * 等某一块画布出现。
 *
 * 用 `page.waitForSelector` 而不是 `expect(locator).toBeVisible()`：后者在这两条用例里
 * **会挂死**——本机实测，它连自己那个 60 秒超时都等不到，一路挂到整条用例超时
 *（两个浏览器、SwiftShader 软件渲染、页面正在建 Pixi 场景，三样凑齐才复现）。
 * 换成 `waitForSelector` 之后同一步稳定在几百毫秒。两者问的是同一个问题
 *（这个元素可见了没有），只是走的不是同一条实现。
 */
export async function waitForCanvas(page: Page, selector: string): Promise<void> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 60_000 })
  } catch (cause: unknown) {
    // 光说「等不到这个元素」看不出是走岔了路还是这一页压根没渲染出来，把现场一起报出来。
    const scene = await page
      .evaluate((one) => {
        const node = document.querySelector(one)
        if (node === null)
          return `页面上没有 ${one}；body 是 ${document.body.innerHTML.slice(0, 300)}`
        const box = node.getBoundingClientRect()
        return `${one} 在，尺寸 ${box.width}×${box.height}`
      }, selector)
      .catch((why: unknown) => `连现场都取不到：${String(why)}`)
    throw new Error(`等不到 ${selector}，此刻这一页在 ${page.url()}；${scene}`, { cause })
  }
}

/** 从首页走进房间页，等到画布和调试口子都就位。 */
export async function openRoomPage(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '联机对战' }).click()
  await waitForCanvas(page, '.room-stage canvas')
  // 进站要先开一个游客号（两三次 HTTP 往返），开出来这一行才有字。
  await untilRoom(page, /"account":"游客/)
}

/** 点「开房」，等房间码到手并返回它。 */
export async function createRoom(page: Page): Promise<string> {
  await page.mouse.click(ENTRY.create.x, ENTRY.create.y)
  await untilRoom(page, /"code":"\d{4}"/)
  const { code } = await roomView(page)
  if (code === null) throw new Error('房间码没拿到')
  return code
}

/** 点「加入」，在弹窗里填码进房。 */
export async function joinRoom(page: Page, code: string): Promise<void> {
  await page.mouse.click(ENTRY.join.x, ENTRY.join.y)
  await page.getByLabel('房间码').fill(code)
  await page.getByRole('button', { name: '进去' }).click()
  await untilRoom(page, new RegExp(`"code":"${code}"`))
}

/** 点「匹配」进全局队列。 */
export async function joinQueue(page: Page): Promise<void> {
  await page.mouse.click(ENTRY.match.x, ENTRY.match.y)
}

/** 点「准备」，并确认钮真的灰成了「已准备」。 */
export async function readyUp(page: Page): Promise<void> {
  // 座位到手、牌组报上去之后这颗钮才摆出来（见 client 的 roomView.ts）。
  await untilRoom(page, /"ready":"idle"/)
  await page.mouse.click(IN_ROOM.ready.x, IN_ROOM.ready.y)
  await untilRoom(page, /"ready":"done"/, 15_000)
}

/** 点「离开」。 */
export async function leaveRoom(page: Page): Promise<void> {
  await page.mouse.click(IN_ROOM.leave.x, IN_ROOM.leave.y)
}
