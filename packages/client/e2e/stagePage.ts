/**
 * 「画布上的这个东西现在在屏幕哪儿」——用例要按坐标点画布时从这里取落点。
 *
 * 落点一律**从渲染出去的那棵 Pixi 树上反查**，不在用例里抄版式公式、更不写死数字。
 * 从前 localMatch.spec.ts 里是一组按 1280×900 推出来的常量，桌面档版式一改就点空
 *（正式版简化第 4 步之二把它改回「1672×941 死版式 + 整块缩放」时就踩了这一下）；
 * 后来改成调 canvas 导出的版式函数，仍然要在用例里复刻一遍「扇形第 n 张的卡心在哪儿」
 * 这段几何。现在两样都不用了：问场景树自己。
 *
 * 实现在 `@ai-duel/canvas` 的 `installHitProbe()` 里，bench 的交互用例读的是同一份
 *（见那个文件的头）。页面这一侧由 `src/dev/debugHook.ts` 的 `stage` 那一格转出来，
 * 只有开发构建挂得上——端到端跑的就是开发服务器。
 *
 * 三件事这里一起办了：
 * 1. **等探针和场景都就位**。口子是异步挂的，而场景还要等卡面图集下完才建得出来。
 * 2. **把画布坐标换成视口坐标**。探针给的是画布自己那套坐标，指针事件要的是视口的。
 * 3. **每次都现问**。卡在屏幕上的位置由这一刻的动画决定，缓存一份下来就没意义了。
 */

import type { HitBox, HitPoint } from '@ai-duel/canvas'
import type { Page } from '@playwright/test'
// 这一句同时把 src/dev/debugHook 里那份 `declare global`（window.__aiDuel）带进来。
import type { StageDebug } from '../src/dev/debugHook'

/** 视口里的一点。 */
export interface Spot {
  x: number
  y: number
}

/** 等探针挂上来要多久。第一次进站要下图集、开游客号，给足。 */
const TIMEOUT = 60_000

/** 画布在视口里的位置。所有坐标都要过这一道。 */
async function canvasOrigin(page: Page, selector: string): Promise<Spot> {
  const box = await page.locator(selector).boundingBox()
  if (box === null) throw new Error(`${selector} 不在页面上，取不到画布位置`)
  return { x: box.x, y: box.y }
}

/**
 * label 以 `prefix` 开头、此刻真点得到的那些对象，按屏幕上从左到右排。
 *
 * 一个都没有就一直等到超时——「这东西现在点不到」和「场景还没画出来」在这儿是同一件事，
 * 而两种都只能等。等不到时报出来的是 prefix 本身，比一句「坐标是 undefined」好查。
 *
 * `within` 限定「只要这个 label 底下的」：手牌里的卡和战场上的卡 label 同一个前缀
 *（都是 `card:<实例 id>`），只要扇形里的就传 `'hand-fan'`。
 */
export async function stageHits(
  page: Page,
  selector: string,
  prefix: string,
  within?: string,
): Promise<(HitPoint & Spot)[]> {
  const handle = await page.waitForFunction(
    ([value, root]) => {
      const points = window.__aiDuel?.stage?.points(value as string, root as string) ?? []
      return points.length > 0 ? points : null
    },
    [prefix, within] as const,
    { timeout: TIMEOUT },
  )
  const points = (await handle.jsonValue()) as HitPoint[]
  const origin = await canvasOrigin(page, selector)
  return points
    .map((one) => ({ ...one, x: one.x + origin.x, y: one.y + origin.y }))
    .sort((a, b) => a.x - b.x)
}

/** label 正好等于 `label` 的那个对象在屏幕上占的矩形（视口坐标）。 */
export async function stageBox(page: Page, selector: string, label: string): Promise<HitBox> {
  const handle = await page.waitForFunction(
    (value) => window.__aiDuel?.stage?.box(value as string) ?? null,
    label,
    { timeout: TIMEOUT },
  )
  const box = (await handle.jsonValue()) as HitBox
  const origin = await canvasOrigin(page, selector)
  return { ...box, x: box.x + origin.x, y: box.y + origin.y }
}

/** 一块矩形的正中。 */
export function centerOf(box: HitBox): Spot {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * 一处「点了什么都不会发生」的空地。
 *
 * 判据是**这一刻的命中测试**：那个坐标点下去，Pixi 找不到任何带 label 的对象。
 * 带 label 的全是「点了有反应」的东西（卡、格子里的卡、两颗钮），所以反过来说，
 * 没有 label 的地方点下去最多落在舞台本身——而舞台上只挂着一件事：
 * 把立着的选目标层收掉（见 canvas 的 scenes/duel/input.ts），这正是用例要的。
 *
 * 每次都**现扫**而不是算一次存起来：场上有没有牌、有没有立着的浮层都会变，
 * 上一轮的空地下一轮可能正好压着一张刚打出去的牌。
 *
 * 扫的是画布上一张粗网格（两边各留一成边距，避开贴边的东西），一次 evaluate 扫完。
 */
export async function inertSpot(page: Page, selector: string): Promise<Spot> {
  const handle = await page.waitForFunction(
    (one) => {
      const probe: StageDebug | undefined = window.__aiDuel?.stage
      if (probe === undefined) return null
      const canvas = document.querySelector(one as string)
      if (!(canvas instanceof HTMLCanvasElement)) return null
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return null
      for (let row = 1; row <= 8; row += 1) {
        for (let column = 1; column <= 8; column += 1) {
          const x = Math.round((width * column) / 9)
          const y = Math.round((height * row) / 9)
          if (probe.labelAt(x, y) === null) return { x, y }
        }
      }
      return null
    },
    selector,
    { timeout: TIMEOUT },
  )
  const spot = (await handle.jsonValue()) as Spot
  const origin = await canvasOrigin(page, selector)
  return { x: spot.x + origin.x, y: spot.y + origin.y }
}
