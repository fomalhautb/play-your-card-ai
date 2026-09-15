/**
 * 单机端到端：从首页点进测试对局，拖一张牌出去，再用测试面板把整局走到结算页。
 * 对应《正式版架构》6.11 里「单机模式一条」那一条。
 *
 * 它守的是**接线**，不是演出：driver、演出编排层、画布场景、React 那几层之间任何一处
 * 接错了，这条用例都过不去——而那些接缝正是单元测试各自测不到的地方
 *（每一层自己都有测试，但「合起来能不能打完一局」只有真跑一遍才知道）。
 *
 * 拖牌走的是**合成指针**（真的 pointerdown / move / up），不是往场景里灌函数调用：
 * Pixi 的事件系统认的就是这几个 DOM 事件，绕过它等于把最容易坏的那一段跳过去。
 *
 * 答题不用管：进答题阶段 2.5 秒后自动交卷（见 src/match/quizAutopilot.ts）。
 */

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { enterTestMatch, openHome } from './homePage'
import { centerOf, inertSpot, type Spot, stageBox, stageHits } from './stagePage'

/** 对局那块画布。所有落点都是相对它算的（见 stagePage.ts）。 */
const STAGE = '.duel-stage canvas'

/**
 * 落点一律**从 Pixi 场景树上反查**，不在这里抄版式公式，也不调版式函数现算。
 *
 * 这里从前写死过一组按 1280×900 推出来的坐标，版式一改就点空——正式版简化第 4 步之二
 * 把桌面档改回「1672×941 死版式 + 整块缩放」时就踩了这一下：扇形锚点、每张牌的间距全变了。
 * 之后改成调 canvas 的版式函数，还是得在这儿复刻一遍「扇形第 n 张的卡心在哪儿」那段几何
 *（卡以底边中点为原点也为旋转轴，外侧那几张是歪的），而那段几何只要组件一改就又对不上。
 * 现在问场景自己：按 label 找到对象，再用 Pixi 的命中测试验一遍那个坐标真的会命中它
 *（实现见 canvas 的 runtime/hitProbe.ts，bench 的交互用例读的是同一份）。
 */

/**
 * 此刻点得到的那些手牌，按屏幕上从左到右排。
 *
 * 限定在扇形（`hand-fan`）底下：战场上打出去的卡 label 是同一个前缀，
 * 不限定的话打出第一张之后「第 2 张手牌」就可能指到场上那张去。
 */
async function handSpots(page: Page): Promise<Spot[]> {
  return await stageHits(page, STAGE, 'card:', 'hand-fan')
}

/**
 * 松手的地方：战场正中。
 *
 * 出牌区就是战场外框本身（见 canvas 的 desktopLayout），而战场那一格（`board-grid`）
 * 整块都在它里面，所以取这一格的正中一定落得进去。空着的时候这一格里只有中线那条横杆，
 * 横杆横贯整格、竖直居中，所以它的外框正中就是整格的正中。
 */
async function dropSpot(page: Page): Promise<Spot> {
  return centerOf(await stageBox(page, STAGE, 'board-grid'))
}

/** 拖第 index 张手牌（0 是最左边那张）到出牌区。点得到的没那么多张就拖最后一张。 */
async function dragCard(page: Page, index: number): Promise<void> {
  const spots = await handSpots(page)
  const from = spots[index] ?? spots.at(-1)
  if (from === undefined) throw new Error('一张手牌都点不到')
  const drop = await dropSpot(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // 中间多走几步是因为拖拽有 4 像素的阈值，一步到位反而可能被当成点击。
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(
      from.x + ((drop.x - from.x) * step) / 5,
      from.y + ((drop.y - from.y) * step) / 5,
    )
  }
  await page.mouse.up()
}

/** 现在轮到谁：测试面板的状态行里那一段。 */
async function statusText(page: Page): Promise<string> {
  return (await page.getByTestId('dev-status').textContent()) ?? ''
}

/**
 * 展开 / 收起测试面板。
 *
 * 拖牌之前必须收起来：面板贴在右下角，展开时正好压住手牌右边那两张（它是 DOM，
 * 盖在画布上面，指针事件都被它截走）。
 */
async function setPanel(page: Page, open: boolean): Promise<void> {
  if ((await page.getByTestId('dev-status').isVisible()) === open) return
  await page.getByRole('button', { name: open ? '测试面板' : '收起面板' }).click()
}

/** 不是我出牌就把出牌权交出去——测试房对面座位上没有人，他不会自己点。 */
async function ensureMyTurn(page: Page): Promise<void> {
  if ((await statusText(page)).includes('行动方 我')) return
  await page.getByRole('button', { name: '结束出牌' }).click()
  await expect.poll(() => statusText(page)).toContain('行动方 我')
}

test('从首页开一局测试对局，拖牌出牌，一路打到结算页', async ({ page }) => {
  /*
   * 首页整页画在画布上（迁移第 30 条），DOM 里没有「测试对局」那颗钮，
   * 所以进对局这一步是按坐标点的——落点由 canvas 导出的版式函数算（见 homePage.ts）。
   */
  await openHome(page)
  await enterTestMatch(page)

  await page.getByRole('button', { name: '测试面板' }).click()
  const status = page.getByTestId('dev-status')
  await expect(status).toContainText('第 1/')

  // 第一步：真的拖一张牌出去。
  const handCount = page.getByTestId('dev-hand-count')
  const before = Number(await handCount.textContent())
  expect(before).toBeGreaterThan(0)

  let played = false
  /*
   * 一张张试过去，直到打出一张或者时间用完。判据是「手牌少了一张」。
   * 这不是在掩盖不稳定，三条都是真规矩：
   *
   * - **换着牌试**：手上五张里可能好几张现在打不出去——要选目标的技能牌（拖出去只会
   *   立起选目标层）、Token 不够的贵牌（引擎直接拒）。手牌是洗出来的，赌不了运气。
   * - **每次等满 2.8 秒**：出牌那一下编排层就把演出锁上了，指令被拒时那把锁靠
   *   PLAY_LOCK_FALLBACK_MS（2.5 秒）兜底放开，没等满的话下一次拖拽会被锁挡掉，
   *   白白浪费一张牌的机会。
   * - **按时间预算而不是按次数重试**：开局那段（抛硬币 3.54 秒 + 发牌）是锁着的，
   *   而它按**真实帧间隔**推进、每帧最多推 100 毫秒（见 DuelStage 的 MAX_FRAME_MS）。
   *   跑机上是 SwiftShader 软件渲染，帧率掉到几帧时，这段 8 秒的开局能拖到几十秒，
   *   前面好几次拖拽全落在锁上（本机实测：闲着的时候第 3 次就出得去，
   *   旁边有别的活在跑时十几次都还锁着）。数次数的话，「几次才够」就成了一个
   *   跟着跑机快慢漂的数字；数时间才是这条用例真正想说的：
   *   **两分半之内总该打得出一张牌**。
   */
  const order = [2, 1, 3, 0, 4]
  const deadline = Date.now() + 150_000
  for (let attempt = 0; !played && Date.now() < deadline; attempt += 1) {
    await setPanel(page, true)
    await ensureMyTurn(page)
    await setPanel(page, false)
    /*
     * 先点一下空地，把上一次可能立起来的选目标层收掉（那一层点哪儿都是取消）。
     * 空地每轮现扫：场上多了一张牌、或者哪层浮层立着，上一轮的空地就不一定还空着。
     */
    const idle = await inertSpot(page, STAGE)
    await page.mouse.click(idle.x, idle.y)
    await dragCard(page, order[attempt % order.length] ?? 2)
    await page.waitForTimeout(2800)
    await setPanel(page, true)
    played = Number(await handCount.textContent()) < before
  }
  expect(played, '两分半之内把五张手牌轮着拖了好几圈，一张都没能打出去').toBe(true)

  /*
   * 第二步：把剩下的轮次走完。
   *
   * 每一轮「跳到答题 → 等自动交卷 → 双方确认」。题库 8 道题，所以最多 8 轮就一定收场
   *（先到 3 分会更早结束，那时循环从上面那条判断跳出去）。
   */
  const result = page.locator('.result')
  for (let round = 0; round < 10; round += 1) {
    if (await result.isVisible()) break
    await page.getByRole('button', { name: '跳到答题' }).click()
    // 自动交卷要等 2.5 秒，加上演出，给到 30 秒。
    await expect(status).toContainText('结算', { timeout: 30_000 })
    await page.getByRole('button', { name: '确认本轮' }).click()
    await expect.poll(() => statusText(page)).not.toContain('结算')
  }

  // 结算页出来了，而且给了两条出路。
  await expect(result).toBeVisible()
  await expect(result.getByRole('button', { name: '再来一局' })).toBeVisible()
  await expect(result.getByRole('button', { name: '回首页' })).toBeVisible()

  /*
   * 点「回首页」真的回得去。判据是首页那块画布又出现了——首页整页在画布上，
   * DOM 里没有任何一颗按钮可以拿来当路标（这也是这条断言从「看得见『测试对局』」
   * 改成「看得见画布」的原因）。
   */
  await result.getByRole('button', { name: '回首页' }).click()
  await expect(page.locator('.home-stage canvas')).toBeVisible({ timeout: 60_000 })
})
